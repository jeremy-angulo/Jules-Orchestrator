import pytest
import os
import json
import pandas as pd
from fastapi.testclient import TestClient
from unittest.mock import patch

import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app, get_db
from database import Base
from models import Workflow, RunHistory
from engine.executor import run_pipeline

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
from sqlalchemy.pool import StaticPool
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    # Cleanup DB after tests
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(autouse=True)
def mock_sessionlocal(monkeypatch):
    """Mock SessionLocal to use our test db in executor.py"""
    monkeypatch.setattr("engine.executor.SessionLocal", TestingSessionLocal)

def test_generate_block(setup_db):
    # Mock the ai_builder.build_block function to avoid actual API calls
    with patch("main.build_block") as mock_build_block:
        mock_build_block.return_value = None

        response = client.post(
            "/api/blocks/generate",
            json={"prompt": "Find emails on the page", "name": "test_email_finder"}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"
        mock_build_block.assert_called_once_with("Find emails on the page", "test_email_finder")

@pytest.mark.asyncio
async def test_run_pipeline_chunking(setup_db):
    db = TestingSessionLocal()

    # 1. Create a dummy workflow
    nodes = [
        {"id": "node_input", "type": "input", "data": {}},
        {"id": "node_action", "type": "action", "data": {"script_name": "csv_loader"}} # Use csv_loader.py which just passes data
    ]
    edges = [
        {"source": "node_input", "target": "node_action"}
    ]

    workflow = Workflow(
        name="Test Workflow Chunking",
        nodes_json=json.dumps(nodes),
        edges_json=json.dumps(edges)
    )
    db.add(workflow)
    db.commit()
    db.refresh(workflow)

    # 2. Create a dummy input CSV (10 lines)
    input_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data_workspace", "inputs")
    os.makedirs(input_dir, exist_ok=True)
    input_csv_path = os.path.join(input_dir, "test_input_chunking.csv")

    df = pd.DataFrame({"id": range(1, 11), "name": [f"User{i}" for i in range(1, 11)]})
    df.to_csv(input_csv_path, index=False)

    # Relative path from backend
    rel_input_csv_path = os.path.join("..", "data_workspace", "inputs", "test_input_chunking.csv")

    # 3. Create a RunHistory record
    run_id = "test_run_chunking_123"
    run_record = RunHistory(id=run_id, workflow_id=workflow.id, status="pending", logs_text="")
    db.add(run_record)
    db.commit()

    # 4. Execute pipeline with chunk_size=3
    # 10 lines with chunk_size 3 -> 4 chunks (3, 3, 3, 1)
    await run_pipeline(run_id, workflow.id, rel_input_csv_path, chunk_size=3)

    # 5. Verify the run was successful
    db.refresh(run_record)
    assert run_record.status == "success"

    # 6. Verify the final concatenated output file exists and has 10 lines
    runs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data_workspace", "runs"))
    final_output_path = os.path.join(runs_dir, f"run_{run_id}_step_node_action.csv")

    assert os.path.exists(final_output_path)
    df_out = pd.read_csv(final_output_path)
    assert len(df_out) == 10
    assert list(df_out["id"]) == list(range(1, 11))

    # Test the data preview endpoint
    preview_res = client.get(f"/api/data/preview?run_id={run_id}&node_id=node_action")
    assert preview_res.status_code == 200
    preview_data = preview_res.json()
    assert "columns" in preview_data
    assert "rows" in preview_data
    assert len(preview_data["rows"]) == 10
    assert preview_data["rows"][0]["id"] == 1

    # Cleanup artifacts
    db.close()
    if os.path.exists(input_csv_path):
        os.remove(input_csv_path)
    if os.path.exists(final_output_path):
        os.remove(final_output_path)

    # Remove chunk files
    import glob
    chunk_files = glob.glob(os.path.join(runs_dir, f"run_{run_id}_chunk_*"))
    for f in chunk_files:
        os.remove(f)

@pytest.mark.asyncio
async def test_run_pipeline_global_config(setup_db):
    db = TestingSessionLocal()

    # Create dummy workflow
    nodes = [
        {"id": "node_input", "type": "input", "data": {}},
        {"id": "node_action", "type": "action", "data": {"script_name": "csv_loader", "config": {"local_val": 42}}}
    ]
    edges = [
        {"source": "node_input", "target": "node_action"}
    ]

    workflow = Workflow(
        name="Test Workflow Config",
        nodes_json=json.dumps(nodes),
        edges_json=json.dumps(edges)
    )
    db.add(workflow)
    db.commit()
    db.refresh(workflow)

    # Create dummy input CSV
    input_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data_workspace", "inputs")
    os.makedirs(input_dir, exist_ok=True)
    input_csv_path = os.path.join(input_dir, "test_input_config.csv")
    df = pd.DataFrame({"id": [1, 2]})
    df.to_csv(input_csv_path, index=False)
    rel_input_csv_path = os.path.join("..", "data_workspace", "inputs", "test_input_config.csv")

    # Create RunHistory record
    run_id = "test_run_config_123"
    run_record = RunHistory(id=run_id, workflow_id=workflow.id, status="pending", logs_text="")
    db.add(run_record)
    db.commit()

    # Run pipeline with global config containing an API key
    global_config = {"api_key": "SUPER_SECRET_TOKEN_999", "other_setting": "yes"}
    await run_pipeline(run_id, workflow.id, rel_input_csv_path, chunk_size=3, global_config=global_config)

    db.refresh(run_record)
    assert run_record.status == "success"

    # Verify log masking
    logs = run_record.logs_text
    assert "SUPER_SECRET_TOKEN_999" not in logs
    assert "***" in logs
    assert "other_setting" in logs
    assert "local_val" in logs

    # Verify that trigger_run endpoint accepts the POST schema correctly
    # We will simulate the POST to run API using TestClient
    # The endpoint uses db via dependency injection. To ensure the test client uses our testing DB where the workflow exists:
    app.dependency_overrides[get_db] = override_get_db

    # We need to add the workflow to the test client's db which is managed by `override_get_db`
    # However, override_get_db creates a new TestingSessionLocal for each request.
    # So we need to insert the workflow into that new session/db context before making the request.
    # Since TestingSessionLocal binds to the engine we set up at the top, the tables and data
    # should persist, provided we don't drop them. It might be dropping or creating new ones.
    # Actually, SQLAlchemy with SQLite in-memory without shared cache might create a new DB per connection.
    # We used connect_args={"check_same_thread": False} and StaticPool usually to share it, but let's just
    # use the exact workflow we created. The engine is global here: engine = create_engine(SQLALCHEMY_DATABASE_URL...)
    # We used setup_db fixture which does Base.metadata.create_all(bind=engine).

    response = client.post(f"/api/workflows/{workflow.id}/run", json={
        "input_csv_path": rel_input_csv_path,
        "global_config": global_config
    })
    assert response.status_code == 200
    assert response.json()["status"] == "pending"

    # Cleanup artifacts
    db.close()
    if os.path.exists(input_csv_path):
        os.remove(input_csv_path)

    runs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data_workspace", "runs"))
    final_output_path = os.path.join(runs_dir, f"run_{run_id}_step_node_action.csv")
    if os.path.exists(final_output_path):
        os.remove(final_output_path)

    import glob
    chunk_files = glob.glob(os.path.join(runs_dir, f"run_{run_id}_chunk_*"))
    for f in chunk_files:
        os.remove(f)
