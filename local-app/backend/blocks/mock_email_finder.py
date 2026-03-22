import argparse
import pandas as pd
import json
import time
import sys

def main():
    parser = argparse.ArgumentParser(description="Mock Email Finder Block")
    parser.add_argument("--input", required=True, help="Input CSV file path")
    parser.add_argument("--output", required=True, help="Output CSV file path")
    parser.add_argument("--config", required=False, default="{}", help="Configuration JSON string")

    args = parser.parse_args()

    try:
        config = json.loads(args.config)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to parse config JSON: {str(e)}"}))
        sys.exit(1)

    company_col = config.get("target_column", "company")

    try:
        df = pd.read_csv(args.input)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to read input CSV: {str(e)}"}))
        sys.exit(1)

    rows_processed = len(df)
    cost_per_row = 0.02
    total_cost = rows_processed * cost_per_row

    if company_col not in df.columns:
        print(json.dumps({"status": "error", "message": f"Column '{company_col}' not found in CSV."}))
        sys.exit(1)

    found_emails = []

    for index, row in df.iterrows():
        company_name = str(row[company_col]).strip().lower()
        company_domain = company_name.replace(" ", "") + ".com"

        # Simulate API Call
        time.sleep(1)

        email = f"contact@{company_domain}"
        found_emails.append(email)

        # Stream logs for real-time updates
        print(json.dumps({
            "status": "processing",
            "row": index + 1,
            "cost": cost_per_row,
            "email_found": email
        }))
        sys.stdout.flush()

    df["found_email"] = found_emails

    try:
        df.to_csv(args.output, index=False)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write output CSV: {str(e)}"}))
        sys.exit(1)

    meta_path = f"{args.output}.meta.json"
    meta_data = {
        "estimated_cost_usd": total_cost,
        "rows_processed": rows_processed
    }

    try:
        with open(meta_path, "w") as f:
            json.dump(meta_data, f)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write metadata: {str(e)}"}))
        sys.exit(1)

    print(json.dumps({"status": "success", "rows_processed": rows_processed, "cost": total_cost}))

if __name__ == "__main__":
    main()
