import argparse
import pandas as pd
import json
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="CSV Loader Block")
    parser.add_argument("--input", required=True, help="Input CSV file path")
    parser.add_argument("--output", required=True, help="Output CSV file path")
    parser.add_argument("--config", required=False, default="{}", help="Configuration JSON string")

    args = parser.parse_args()

    try:
        df = pd.read_csv(args.input)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to read input CSV: {str(e)}"}))
        sys.exit(1)

    rows_processed = len(df)

    try:
        df.to_csv(args.output, index=False)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write output CSV: {str(e)}"}))
        sys.exit(1)

    meta_path = f"{args.output}.meta.json"
    meta_data = {
        "estimated_cost_usd": 0.0,
        "rows_processed": rows_processed
    }

    try:
        with open(meta_path, "w") as f:
            json.dump(meta_data, f)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write metadata: {str(e)}"}))
        sys.exit(1)

    print(json.dumps({"status": "success", "rows_processed": rows_processed, "cost": 0.0}))

if __name__ == "__main__":
    main()
