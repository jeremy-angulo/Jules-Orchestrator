import argparse
import pandas as pd
import json
import httpx
import sys

def main():
    parser = argparse.ArgumentParser(description="Basic Web Scraper Block")
    parser.add_argument("--input", required=True, help="Input CSV file path")
    parser.add_argument("--output", required=True, help="Output CSV file path")
    parser.add_argument("--config", required=False, default="{}", help="Configuration JSON string")

    args = parser.parse_args()

    try:
        config = json.loads(args.config)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to parse config JSON: {str(e)}"}))
        sys.exit(1)

    website_col = config.get("target_column", "website")

    try:
        df = pd.read_csv(args.input)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to read input CSV: {str(e)}"}))
        sys.exit(1)

    rows_processed = len(df)

    if website_col not in df.columns:
        print(json.dumps({"status": "error", "message": f"Column '{website_col}' not found in CSV."}))
        sys.exit(1)

    status_codes = []
    success_count = 0
    cost_per_success = 0.001

    for index, row in df.iterrows():
        url = str(row[website_col]).strip()

        # Format the URL if missing schema
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.get(url)
                status_code = response.status_code
                status_codes.append(status_code)

                if status_code == 200:
                    success_count += 1

                print(json.dumps({
                    "status": "processing",
                    "row": index + 1,
                    "url": url,
                    "status_code": status_code
                }))
        except httpx.TimeoutException:
            status_codes.append("Timeout")
            print(json.dumps({
                "status": "processing",
                "row": index + 1,
                "url": url,
                "error": "Timeout"
            }))
        except Exception as e:
            status_codes.append(str(e))
            print(json.dumps({
                "status": "processing",
                "row": index + 1,
                "url": url,
                "error": str(e)
            }))

        sys.stdout.flush()

    df["status_code"] = status_codes

    try:
        df.to_csv(args.output, index=False)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write output CSV: {str(e)}"}))
        sys.exit(1)

    total_cost = success_count * cost_per_success
    meta_path = f"{args.output}.meta.json"
    meta_data = {
        "estimated_cost_usd": total_cost,
        "rows_processed": rows_processed,
        "success_count": success_count
    }

    try:
        with open(meta_path, "w") as f:
            json.dump(meta_data, f)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to write metadata: {str(e)}"}))
        sys.exit(1)

    print(json.dumps({"status": "success", "rows_processed": rows_processed, "success_count": success_count, "cost": total_cost}))

if __name__ == "__main__":
    main()
