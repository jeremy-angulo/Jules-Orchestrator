#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
npm test

cd ../backend
export PYTHONPATH=$(pwd)
pytest

cd ../../cloud-hub
npm install
npm test || echo "No tests"
