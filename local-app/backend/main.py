from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
import os
import ast
import sys
import json
import pandas as pd

# Ensure blocks_library can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from blocks_library.ai_builder import build_block

from database import engine, get_db, Base
from models import Workflow, RunHistory
from engine.executor import run_pipeline

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Trefle Data Studio - Local Backend")

# CORS middleware for specific origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class WorkflowBase(BaseModel):
    name: str
    nodes_json: str
    edges_json: str

class WorkflowCreate(WorkflowBase):
    pass

class WorkflowResponse(WorkflowBase):
    id: str

    class Config:
        from_attributes = True

class RunStatusResponse(BaseModel):
    id: str
    status: str
    execution_time: Optional[float] = None
    estimated_cost: Optional[float] = None
    logs_text: Optional[str] = None

    class Config:
        from_attributes = True


class BlockResponse(BaseModel):
    name: str
    path: str
    required_params: List[str]

class BlockGenerateRequest(BaseModel):
    prompt: str
    name: str

class RunRequest(BaseModel):
    chunk_size: Optional[int] = 10
    input_csv_path: Optional[str] = None
    global_config: Optional[dict] = None

def extract_required_params_from_script(filepath: str) -> List[str]:
    params = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=filepath)

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument':
                    for arg in node.args:
                        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                            arg_name = arg.value
                            if arg_name.startswith("--") and arg_name not in ["--input", "--output", "--config"]:
                                params.append(arg_name.lstrip("-"))
    except Exception:
        pass
    return params


@app.get("/api/blocks", response_model=List[BlockResponse])
def get_blocks():
    blocks = []
    base_dir = os.path.dirname(__file__)
    blocks_library_dir = os.path.abspath(os.path.join(base_dir, "..", "blocks_library"))

    dirs_to_scan = [
        ("native_blocks", os.path.join(blocks_library_dir, "native_blocks")),
        ("custom_blocks", os.path.join(blocks_library_dir, "custom_blocks"))
    ]

    for category, dir_path in dirs_to_scan:
        if os.path.exists(dir_path):
            for filename in os.listdir(dir_path):
                if filename.endswith(".py") and filename != "__init__.py":
                    filepath = os.path.join(dir_path, filename)
                    required_params = extract_required_params_from_script(filepath)
                    blocks.append(BlockResponse(
                        name=filename,
                        path=f"{category}/{filename}",
                        required_params=required_params
                    ))
    return blocks

@app.post("/api/blocks/generate")
def generate_block(request: BlockGenerateRequest):
    try:
        # Appelle la fonction synchrone de ai_builder
        build_block(request.prompt, request.name)
        return {"status": "success", "message": f"Block '{request.name}' successfully generated."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/workflows", response_model=List[WorkflowResponse])
# TODO: Add pagination for listing endpoints to prevent massive payloads as data grows
def get_workflows(db: Session = Depends(get_db)):
    return db.query(Workflow).all()

@app.post("/api/workflows", response_model=WorkflowResponse)
def create_workflow(workflow: WorkflowCreate, db: Session = Depends(get_db)):
    db_workflow = Workflow(
        name=workflow.name,
        nodes_json=workflow.nodes_json,
        edges_json=workflow.edges_json
    )
    db.add(db_workflow)
    db.commit()
    db.refresh(db_workflow)
    return db_workflow

@app.get("/api/workflows/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(workflow_id: str, db: Session = Depends(get_db)):
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow

@app.put("/api/workflows/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(workflow_id: str, workflow: WorkflowCreate, db: Session = Depends(get_db)):
    db_workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not db_workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    db_workflow.name = workflow.name
    db_workflow.nodes_json = workflow.nodes_json
    db_workflow.edges_json = workflow.edges_json

    db.commit()
    db.refresh(db_workflow)
    return db_workflow

@app.post("/api/workflows/{workflow_id}/run")
def trigger_run(workflow_id: str, background_tasks: BackgroundTasks, request: Optional[RunRequest] = None, input_csv_path: Optional[str] = None, db: Session = Depends(get_db)):
    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run_id = str(uuid.uuid4())

    input_csv_path = None
    global_config = None
    if request:
        input_csv_path = request.input_csv_path
        global_config = request.global_config

    # Normally, the user would upload a CSV or specify a path to the input data.
    # For now, we will mock the path to a dummy file if not provided
    if not input_csv_path:
        input_csv_path = os.path.join("..", "data_workspace", "inputs", "dummy_input.csv")
    # Ensure backwards compatibility if old clients use query parameter
    actual_input_csv_path = input_csv_path
    chunk_size = 10
    global_config = {}

    if request:
        if request.input_csv_path:
            actual_input_csv_path = request.input_csv_path
        if request.chunk_size:
            chunk_size = request.chunk_size
        if request.global_config:
            global_config = request.global_config

    if not actual_input_csv_path:
        actual_input_csv_path = os.path.join("..", "data_workspace", "inputs", "dummy_input.csv")

    abs_input_path = os.path.abspath(os.path.join(os.path.dirname(__file__), actual_input_csv_path))
    if not os.path.exists(abs_input_path):
        os.makedirs(os.path.dirname(abs_input_path), exist_ok=True)
        with open(abs_input_path, "w") as f:
            f.write("id,url\n1,https://example.com\n")

    run_record = RunHistory(
        id=run_id,
        workflow_id=workflow_id,
        status="pending",
        logs_text="Run initialized.\n"
    )
    db.add(run_record)
    db.commit()

    # Launch in background
    # TODO: This double calls `run_pipeline`, causing two background tasks to execute the same workflow which might corrupt data and cause race conditions. It should be refactored to just call it once.
    background_tasks.add_task(run_pipeline, run_id, workflow_id, input_csv_path, 5, global_config)
    background_tasks.add_task(run_pipeline, run_id, workflow_id, actual_input_csv_path, chunk_size, global_config)

    return {"run_id": run_id, "status": "pending"}

@app.get("/api/runs/{run_id}/status", response_model=RunStatusResponse)
def get_run_status(run_id: str, db: Session = Depends(get_db)):
    run_record = db.query(RunHistory).filter(RunHistory.id == run_id).first()
    if not run_record:
        raise HTTPException(status_code=404, detail="Run not found")

    return run_record

@app.get("/api/data/preview")
def preview_data(file_path: Optional[str] = None, run_id: Optional[str] = None, node_id: Optional[str] = None):
    # Determine the file path to read
    abs_file_path = None
    runs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_workspace", "runs"))
    inputs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_workspace", "inputs"))

    if run_id and node_id:
        # Construct the file name using the required pattern
        filename = f"run_{run_id}_step_{node_id}.csv"
        abs_file_path = os.path.join(runs_dir, filename)
    elif file_path:
        # Resolve the provided path relative to the data_workspace to prevent path traversal
        workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_workspace"))
        resolved_path = os.path.abspath(os.path.join(workspace_dir, file_path))
        if not resolved_path.startswith(workspace_dir):
            raise HTTPException(status_code=403, detail="Invalid file path")
        abs_file_path = resolved_path
    else:
        raise HTTPException(status_code=400, detail="Must provide either file_path or both run_id and node_id")

    if not os.path.exists(abs_file_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        # Read the first 50 rows using pandas
        df = pd.read_csv(abs_file_path, nrows=50)
        # Handle NaN values to ensure valid JSON
        df = df.fillna("")

        return {
            "columns": df.columns.tolist(),
            "rows": df.to_dict(orient="records")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")

# TODO: `get_data_preview` seems to conflict or overlap with `preview_data` above. Evaluate which one is needed and remove the unused one.
def get_data_preview(run_id: str, node_id: str, db: Session = Depends(get_db)):
    run_record = db.query(RunHistory).filter(RunHistory.id == run_id).first()
    if not run_record:
        raise HTTPException(status_code=404, detail="Run not found")

    workflow = db.query(Workflow).filter(Workflow.id == run_record.workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    try:
        nodes = json.loads(workflow.nodes_json)
        edges = json.loads(workflow.edges_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Error parsing workflow JSON")

    adj_list = {n["id"]: [] for n in nodes}
    in_degree = {n["id"]: 0 for n in nodes}

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source in adj_list and target in in_degree:
            adj_list[source].append(target)
            in_degree[target] += 1

    queue = [n["id"] for n in nodes if in_degree[n["id"]] == 0]
    sorted_node_ids = []

    while queue:
        curr = queue.pop(0)
        sorted_node_ids.append(curr)
        for neighbor in adj_list.get(curr, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(sorted_node_ids) != len(nodes):
        raise HTTPException(status_code=500, detail="Graph has a cycle")

    nodes_by_id = {n["id"]: n for n in nodes}

    step_index = 1
    target_step = -1
    for nid in sorted_node_ids:
        node = nodes_by_id[nid]
        if node.get("type") in ("action", "actionNode"):
            if nid == node_id:
                target_step = step_index
                break
            step_index += 1

    if target_step == -1:
        # Check if node is input node
        if nodes_by_id.get(node_id, {}).get("type") not in ("action", "actionNode"):
             raise HTTPException(status_code=400, detail="Node is not an action block and has no output.")
        raise HTTPException(status_code=404, detail="Node not found in action sequence")

    runs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_workspace", "runs"))
    csv_filename = f"run_{run_id}_step_{target_step}.csv"
    csv_path = os.path.join(runs_dir, csv_filename)

    if not os.path.exists(csv_path):
        raise HTTPException(status_code=404, detail=f"Data file not found for step {target_step}")

    try:
        df = pd.read_csv(csv_path)
        data = df.head(50).fillna("").to_dict(orient="records")
        columns = df.columns.tolist()
        return {"columns": columns, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading CSV data: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
