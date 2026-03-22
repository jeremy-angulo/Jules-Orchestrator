import asyncio
import json
import os
import time
import math
import pandas as pd
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Workflow, RunHistory

async def run_pipeline(run_id: str, workflow_id: str, input_csv_path: str, chunk_size: int = 5, global_config: dict = None):
    if global_config is None:
        global_config = {}

    # Initialize run history log
    db = SessionLocal()
    run_record = db.query(RunHistory).filter(RunHistory.id == run_id).first()
    if not run_record:
        run_record = RunHistory(id=run_id, workflow_id=workflow_id, status="running", logs_text="")
        db.add(run_record)
        db.commit()
    else:
        run_record.status = "running"
        run_record.logs_text = ""
        db.commit()

    start_time = time.time()

    workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
    if not workflow:
        run_record.status = "failed"
        run_record.logs_text = f"Error: Workflow {workflow_id} not found.\n"
        db.commit()
        db.close()
        return

    try:
        nodes = json.loads(workflow.nodes_json)
        edges = json.loads(workflow.edges_json)
    except json.JSONDecodeError as e:
        run_record.status = "failed"
        run_record.logs_text = f"Error parsing workflow JSON: {e}\n"
        db.commit()
        db.close()
        return

    # Build adjacency list and in-degree count for topological sort
    adj_list = {n["id"]: [] for n in nodes}
    in_degree = {n["id"]: 0 for n in nodes}

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source in adj_list and target in in_degree:
            adj_list[source].append(target)
            in_degree[target] += 1

    # Find start nodes (in-degree 0)
    queue = [n["id"] for n in nodes if in_degree[n["id"]] == 0]
    sorted_node_ids = []

    while queue:
        curr = queue.pop(0)
        sorted_node_ids.append(curr)
        for neighbor in adj_list.get(curr, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    # TODO: Check if this topological sort properly handles completely disconnected subgraphs
    if len(sorted_node_ids) != len(nodes):
        run_record.status = "failed"
        run_record.logs_text = "Error: Graph has a cycle, cannot perform topological sort.\n"
        db.commit()
        db.close()
        return

    nodes_by_id = {n["id"]: n for n in nodes}

    total_cost = 0.0

    # Read the main input CSV
    abs_input_csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", input_csv_path))
    try:
        # TODO: Optimize memory usage by reading the CSV in chunks directly using `pd.read_csv(chunksize=...)` instead of loading the entire file
        df_main = pd.read_csv(abs_input_csv_path)
    except Exception as e:
        run_record.status = "failed"
        run_record.logs_text += f"Error reading input CSV {abs_input_csv_path}: {e}\n"
        db.commit()
        db.close()
        return

    num_rows = len(df_main)
    num_chunks = math.ceil(num_rows / chunk_size)

    # Dictionaries to keep track of the final concatenated files and their parts
    # final_output_files[node_id] = path to the final assembled file
    final_output_files = {}
    chunk_files_by_node = {node_id: [] for node_id in sorted_node_ids}

    # Prepare directories
    runs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data_workspace", "runs"))
    os.makedirs(runs_dir, exist_ok=True)

    for chunk_idx in range(num_chunks):
        start_idx = chunk_idx * chunk_size
        end_idx = min((chunk_idx + 1) * chunk_size, num_rows)
        df_chunk = df_main.iloc[start_idx:end_idx]

        # Create a temporary chunk input file
        chunk_input_csv = os.path.join(runs_dir, f"run_{run_id}_chunk_{chunk_idx}_input.csv")
        df_chunk.to_csv(chunk_input_csv, index=False)

        # Track outputs for this specific chunk through the nodes
        chunk_node_outputs = {}

        step_index = 1
        for node_id in sorted_node_ids:
            node = nodes_by_id[node_id]

            if node.get("type") not in ("action", "actionNode"):
                chunk_node_outputs[node_id] = chunk_input_csv
                continue

            node_data = node.get("data", {})

            # Determine input for this node within this chunk execution
            incoming_edges = [e for e in edges if e.get("target") == node_id]
            if incoming_edges:
                source_id = incoming_edges[0].get("source")
                current_input_csv = chunk_node_outputs.get(source_id)
                if not current_input_csv:
                    current_input_csv = chunk_input_csv
            else:
                current_input_csv = chunk_input_csv

            script_name = node_data.get("script_name", "base_scraper")
            node_config = node_data.get("config", {})

            # Merge global_config and node_config. Node config takes precedence if keys conflict.
            merged_config = {**global_config, **node_config}
            config_json = json.dumps(merged_config)

            if not script_name.endswith(".py"):
                script_name += ".py"

            script_path = os.path.join("..", "blocks_library", "custom_blocks", script_name)
            abs_script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", script_path))

            if not os.path.exists(abs_script_path):
                script_path = os.path.join("..", "blocks_library", "native_blocks", script_name)
                abs_script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", script_path))
                if not os.path.exists(abs_script_path):
                    run_record.status = "failed"
                    run_record.logs_text += f"Error: Script {script_name} not found in custom or native blocks.\n"
                    db.commit()
                    db.close()
                    return

            # Output file for this specific chunk and node
            output_csv_name = f"run_{run_id}_chunk_{chunk_idx}_step_{node_id}.csv"
            abs_output_csv = os.path.join(runs_dir, output_csv_name)

            chunk_node_outputs[node_id] = abs_output_csv
            chunk_files_by_node[node_id].append(abs_output_csv)

            cmd = [
                "python", abs_script_path,
                "--input", current_input_csv,
                "--output", abs_output_csv,
                "--config", config_json
            ]

            sanitized_config = {}
            for k, v in merged_config.items():
                if any(sec in k.lower() for sec in ["api", "key", "token", "secret", "password"]):
                    sanitized_config[k] = "***"
                else:
                    sanitized_config[k] = v
            sanitized_config_json = json.dumps(sanitized_config)

            sanitized_cmd = [
                "python", abs_script_path,
                "--input", current_input_csv,
                "--output", abs_output_csv,
                "--config", f"'{sanitized_config_json}'"
            ]

            log_msg = f"Executing Chunk {chunk_idx + 1}/{num_chunks} - Step {step_index} (Node {node_id}): {' '.join(sanitized_cmd)}\n"
            run_record.logs_text = (run_record.logs_text or "") + log_msg
            db.commit()

            try:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                log_queue = asyncio.Queue()

                async def stream_to_queue(stream, prefix):
                    while True:
                        line = await stream.readline()
                        if not line:
                            break
                        decoded_line = line.decode().rstrip()
                        await log_queue.put(f"{prefix} {decoded_line}\n")

                async def queue_to_db():
                    # TODO: Use context manager for `log_db` instead of manual close to ensure it's always cleaned up
                    log_db = SessionLocal()
                    try:
                        while True:
                            msg = await log_queue.get()
                            if msg is None:
                                break
                            record = log_db.query(RunHistory).filter(RunHistory.id == run_id).first()
                            if record:
                                record.logs_text = (record.logs_text or "") + msg
                                log_db.commit()
                    finally:
                        log_db.close()

                consumer_task = asyncio.create_task(queue_to_db())

                await asyncio.gather(
                    stream_to_queue(process.stdout, "STDOUT:"),
                    stream_to_queue(process.stderr, "STDERR:")
                )

                await log_queue.put(None)
                await consumer_task

                await process.wait()

                db.refresh(run_record)

                if process.returncode != 0:
                    run_record.status = "failed"
                    run_record.logs_text += f"Chunk {chunk_idx} Step {step_index} failed with return code {process.returncode}.\n"
                    db.commit()
                    db.close()
                    return

                meta_file_path = abs_output_csv.replace(".csv", ".meta.json")
                if os.path.exists(meta_file_path):
                    try:
                        with open(meta_file_path, "r") as f:
                            meta_data = json.load(f)
                            added_cost = meta_data.get("estimated_cost", 0.0)
                            if "estimated_cost_usd" in meta_data:
                                added_cost = meta_data.get("estimated_cost_usd", 0.0)
                            total_cost += added_cost

                            exec_time = meta_data.get("execution_time_sec", 0.0)
                            run_record.logs_text += f"[METRICS] Node {node_id} time={exec_time} cost={added_cost}\n"
                    except Exception as e:
                        run_record.logs_text += f"Warning: Failed to read meta file {meta_file_path}: {e}\n"

                db.commit()

            except Exception as e:
                run_record.status = "failed"
                run_record.logs_text += f"Error executing chunk {chunk_idx} step {step_index}: {e}\n"
                db.commit()
                db.close()
                return

            step_index += 1

    # After all chunks are processed, combine the files for each step to mimic global run output
    step_index = 1
    for node_id in sorted_node_ids:
        node = nodes_by_id[node_id]
        if node.get("type") not in ("action", "actionNode"):
            continue

        chunk_files = chunk_files_by_node[node_id]
        if chunk_files:
            combined_df = pd.DataFrame()
            for cf in chunk_files:
                if os.path.exists(cf):
                    df_part = pd.read_csv(cf)
                    combined_df = pd.concat([combined_df, df_part], ignore_index=True)

            final_output_csv_name = f"run_{run_id}_step_{node_id}.csv"
            final_abs_output_csv = os.path.join(runs_dir, final_output_csv_name)
            combined_df.to_csv(final_abs_output_csv, index=False)

            # Optional cleanup of chunk files
            # for cf in chunk_files:
            #     os.remove(cf)

        step_index += 1

    # Finished
    execution_time = time.time() - start_time
    run_record.status = "success"
    run_record.execution_time = execution_time
    run_record.estimated_cost = total_cost
    run_record.logs_text += f"Pipeline execution completed successfully in {execution_time:.2f} seconds.\n"
    db.commit()
    db.close()
