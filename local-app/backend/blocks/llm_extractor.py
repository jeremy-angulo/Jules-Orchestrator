import argparse
import pandas as pd
import json
import sys
from openai import OpenAI
import os

def main():
    parser = argparse.ArgumentParser(description="LLM Semantic Extractor Block")
    parser.add_argument("--input", required=True, help="Input CSV file path")
    parser.add_argument("--output", required=True, help="Output CSV file path")
    parser.add_argument("--config", required=False, default="{}", help="Configuration JSON string")

    args = parser.parse_args()

    try:
        config = json.loads(args.config)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to parse config JSON: {str(e)}"}))
        sys.exit(1)

    api_key = config.get("openai_api_key")
    if not api_key:
        print(json.dumps({"status": "error", "message": "Missing required config: openai_api_key"}))
        sys.exit(1)

    source_col = config.get("source_column")
    if not source_col:
        print(json.dumps({"status": "error", "message": "Missing required config: source_column"}))
        sys.exit(1)

    extraction_prompt = config.get("extraction_prompt")
    if not extraction_prompt:
        print(json.dumps({"status": "error", "message": "Missing required config: extraction_prompt"}))
        sys.exit(1)

    try:
        df = pd.read_csv(args.input)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to read input CSV: {str(e)}"}))
        sys.exit(1)

    if source_col not in df.columns:
        print(json.dumps({"status": "error", "message": f"Column '{source_col}' not found in CSV."}))
        sys.exit(1)

    rows_processed = len(df)
    success_count = 0
    total_cost = 0.0
    failed_count = 0

    # Initialize OpenAI client
    client = OpenAI(api_key=api_key)

    # We will accumulate new columns dynamically
    new_columns_data = []

    for index, row in df.iterrows():
        text_content = str(row[source_col]).strip()

        # We need a fallback dict for errors on this row
        row_result = {}

        if not text_content:
             print(json.dumps({
                 "status": "processing",
                 "row": index + 1,
                 "error": "Empty source text"
             }))
             failed_count += 1
             new_columns_data.append(row_result)
             continue

        messages = [
            {"role": "system", "content": "You are a data extraction assistant. You must extract information from the user's text according to their prompt and return ONLY a valid JSON object. No markdown formatting or extra text. If a value is not found, return null for that key."},
            {"role": "user", "content": f"Task: {extraction_prompt}\n\nText to analyze:\n{text_content}"}
        ]

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.0
            )

            # Calculate cost
            prompt_tokens = response.usage.prompt_tokens
            completion_tokens = response.usage.completion_tokens

            # gpt-4o-mini pricing (approximate): $0.150 / 1M input tokens, $0.600 / 1M output tokens
            cost = (prompt_tokens / 1_000_000 * 0.150) + (completion_tokens / 1_000_000 * 0.600)
            total_cost += cost

            content = response.choices[0].message.content
            parsed_json = json.loads(content)

            row_result = parsed_json
            success_count += 1

            print(json.dumps({
                "status": "processing",
                "row": index + 1,
                "cost": cost
            }))

        except Exception as e:
            # Add error marker for any keys we might know about (we don't know them in advance though)
            # We'll just append an empty dict and handle the `#ERROR` filling later
            print(json.dumps({
                "status": "processing",
                "row": index + 1,
                "error": str(e)
            }))
            failed_count += 1
            row_result = {"_error": f"#ERROR: {str(e)}"}

        new_columns_data.append(row_result)
        sys.stdout.flush()

    # Discover all keys returned by successful rows to create columns
    all_keys = set()
    for row_res in new_columns_data:
        for k in row_res.keys():
            if k != "_error":
                all_keys.add(k)

    # Populate dataframe with new columns
    if not all_keys and failed_count > 0:
        # If no successful extractions, we at least add an 'error' column to show the failures
        all_keys.add("error")

    for key in all_keys:
        col_values = []
        for row_res in new_columns_data:
            if "_error" in row_res:
                col_values.append(row_res["_error"])
            else:
                col_values.append(row_res.get(key, None))
        df[key] = col_values

    try:
        df.to_csv(args.output, index=False)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write output CSV: {str(e)}"}))
        sys.exit(1)

    meta_path = f"{args.output}.meta.json"
    meta_data = {
        "rows_processed": rows_processed,
        "rows_failed": failed_count,
        "success_count": success_count,
        "estimated_cost_usd": total_cost,
        "execution_time_sec": 0.0 # Standard format requested, we could add time if needed but leaving out for simplicity
    }

    try:
        with open(meta_path, "w") as f:
            json.dump(meta_data, f)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write metadata: {str(e)}"}))
        sys.exit(1)

    print(json.dumps({
        "status": "success",
        "rows_processed": rows_processed,
        "success_count": success_count,
        "rows_failed": failed_count,
        "cost": total_cost
    }))

if __name__ == "__main__":
    main()
