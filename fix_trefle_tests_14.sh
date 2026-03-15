#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
sed -i '453s/onClick={handleAddInputNode}/onClick={handleAddInputNode}>/' src/App.tsx
npm test
