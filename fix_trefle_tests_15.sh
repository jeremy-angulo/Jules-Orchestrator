#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
git add src/App.tsx src/store.ts package.json package-lock.json
git commit -m "Fix React frontend syntax errors and test failures"

cd ../backend
cat -n tests/test_validation.py | grep -C 5 "from main import app"
