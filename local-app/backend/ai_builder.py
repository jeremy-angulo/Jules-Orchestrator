import os
import json
import argparse
import subprocess
import pandas as pd
from openai import OpenAI
from typing import Optional

def get_openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Warning: OPENAI_API_KEY environment variable not set. Please set it before running.")
    return OpenAI(api_key=api_key)

SYSTEM_PROMPT = """Tu es un développeur Python expert en Web Scraping et Agentic Workflows.
Ton rôle est de générer des scripts d'extraction de données robustes pour le "Block Studio".
Le code que tu génères DOIT être strictement un code Python valide et respecter ce format exact :
1. Utiliser `argparse` avec les arguments `--input`, `--output`, `--config`.
2. Utiliser `pandas` pour lire le fichier CSV spécifié dans `--input`.
3. Boucler sur chaque ligne du DataFrame.
4. Gérer les exceptions par ligne (`try/except`) pour ne JAMAIS faire crasher tout le script. En cas d'erreur sur une ligne, enregistre '#ERROR' ou '#ERROR: <details>' pour cette ligne, et passe à la suivante.
5. Utiliser `httpx` + `selectolax` ou `playwright` pour le scraping.
6. Émettre des messages de progression via `print` contenant un JSON valide sur la sortie standard. Par exemple : `print(json.dumps({"row": index, "status": "success/error"}))`.
7. Exporter le DataFrame final via `to_csv` vers le fichier spécifié dans `--output`, sans l'index (index=False).

Ne retourne QUE le code Python. Pas de markdown autour, pas d'explications avant ou après. Le code doit être prêt à être exécuté par `python <fichier>.py --input <in> --output <out> --config <cfg>`.

Voici la structure de base attendue :
```python
import argparse
import pandas as pd
import json
import httpx
from selectolax.parser import HTMLParser

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--config", required=False, default="{}")
    args = parser.parse_args()

    try:
        config = json.loads(args.config)
    except:
        config = {}

    df = pd.read_csv(args.input)

    for index, row in df.iterrows():
        try:
            # Ton code de scraping ici...
            # Exemple: res = httpx.get(row['url'])
            # ...
            # df.at[index, 'new_column'] = data
            print(json.dumps({"row": index, "status": "success"}))
        except Exception as e:
            # df.at[index, 'new_column'] = f"#ERROR: {str(e)}"
            print(json.dumps({"row": index, "status": "error", "message": str(e)}))

    df.to_csv(args.output, index=False)

if __name__ == "__main__":
    main()
```
"""

def generate_script_with_llm(prompt_user: str, error_feedback: Optional[str] = None, previous_code: Optional[str] = None) -> str:
    client = get_openai_client()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT}
    ]

    user_content = f"Génère un script pour accomplir ceci : {prompt_user}"
    messages.append({"role": "user", "content": user_content})

    if previous_code and error_feedback:
        messages.append({"role": "assistant", "content": previous_code})
        messages.append({"role": "user", "content": f"Ton code précédent a planté avec cette erreur. Corrige-le :\n{error_feedback}"})

    response = client.chat.completions.create(
        model="gpt-4o",  # You can adjust this model if necessary
        messages=messages,
        temperature=0.2
    )

    code = response.choices[0].message.content.strip()

    # Clean up markdown code blocks if the LLM stubbornly adds them
    if code.startswith("```python"):
        code = code[9:]
    if code.startswith("```"):
        code = code[3:]
    if code.endswith("```"):
        code = code[:-3]

    return code.strip()

def build_block(prompt_user: str, output_filename: str):
    max_retries = 3
    error_feedback = None
    previous_code = None

    # Base dir for paths
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Create temporary input CSV for testing
    # TODO: Make the temporary CSV filenames dynamic using `uuid` to prevent collision during concurrent generations
    test_in_csv = os.path.join(base_dir, "test_in.csv")
    test_out_csv = os.path.join(base_dir, "test_out.csv")

    # We will provide a simple test CSV for validation
    df = pd.DataFrame([{"url": "https://example.com"}])
    df.to_csv(test_in_csv, index=False)

    print(f"\n--- Starting Generation for '{output_filename}' ---")

    for attempt in range(max_retries):
        print(f"\n[Attempt {attempt + 1}/{max_retries}] Generating script via LLM...")

        # 1. Generate code
        script_code = generate_script_with_llm(prompt_user, error_feedback, previous_code)
        previous_code = script_code

        # 2. Save code to temporary file
        temp_script_path = os.path.join(base_dir, f"temp_{output_filename}.py")
        with open(temp_script_path, "w", encoding="utf-8") as f:
            f.write(script_code)

        print(f"[Attempt {attempt + 1}/{max_retries}] Script generated and saved temporarily at {temp_script_path}. Running validation tests...")

        # 3. Test the script
        # TODO: Execute this inside a secure sandbox or isolated container to prevent malicious execution if the LLM goes rogue
        try:
            result = subprocess.run(
                ["python", temp_script_path, "--input", test_in_csv, "--output", test_out_csv],
                capture_output=True,
                text=True,
                timeout=30 # Prevent infinite hanging
            )

            # Check if there was an error in stderr or return code
            if result.returncode != 0 or "Traceback" in result.stderr:
                error_feedback = f"Stderr:\n{result.stderr}\n\nStdout:\n{result.stdout}"
                print(f"[Attempt {attempt + 1}/{max_retries}] Test Failed! Error encountered:")
                print(result.stderr)
                # Cleanup temp script
                if os.path.exists(temp_script_path):
                    os.remove(temp_script_path)
            else:
                print(f"[Attempt {attempt + 1}/{max_retries}] Test Passed! Script is robust.")

                # Validation Passed: Save to custom_blocks
                final_path = os.path.join(base_dir, "custom_blocks", f"{output_filename}.py")

                # Make sure dir exists
                os.makedirs(os.path.dirname(final_path), exist_ok=True)

                with open(final_path, "w", encoding="utf-8") as f:
                    f.write(script_code)

                print(f"\n✅ Block successfully created and saved at: {final_path}")

                # Cleanup temps
                if os.path.exists(temp_script_path):
                    os.remove(temp_script_path)
                if os.path.exists(test_in_csv):
                    os.remove(test_in_csv)
                if os.path.exists(test_out_csv):
                    os.remove(test_out_csv)

                return # Success

        except subprocess.TimeoutExpired:
            error_feedback = "The script took too long to execute (Timeout > 30s). Make sure to handle timeouts in your code."
            print(f"[Attempt {attempt + 1}/{max_retries}] Test Failed! Timeout.")
            if os.path.exists(temp_script_path):
                os.remove(temp_script_path)
        except Exception as e:
            error_feedback = f"An unexpected error occurred during execution: {str(e)}"
            print(f"[Attempt {attempt + 1}/{max_retries}] Test Failed! Exception: {str(e)}")
            if os.path.exists(temp_script_path):
                os.remove(temp_script_path)

    print(f"\n❌ Failed to generate a working script after {max_retries} attempts.")

    # Cleanup temps
    if os.path.exists(test_in_csv):
        os.remove(test_in_csv)
    if os.path.exists(test_out_csv):
        os.remove(test_out_csv)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Block Studio: AI Builder for robust data extraction scripts.")
    parser.add_argument("--prompt", required=True, type=str, help="The prompt describing what the block should do.")
    parser.add_argument("--name", required=True, type=str, help="The name of the block (will be used for the filename).")

    args = parser.parse_args()

    print(f"Starting Block Studio AI Builder...")
    print(f"Prompt: {args.prompt}")
    print(f"Name: {args.name}")

    build_block(args.prompt, args.name)
