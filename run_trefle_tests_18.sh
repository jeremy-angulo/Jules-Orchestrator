#!/bin/bash
cd /app/TrefleAI_IHM/local-app/backend
pip install -r requirements.txt
export PYTHONPATH=$(pwd)
pytest
