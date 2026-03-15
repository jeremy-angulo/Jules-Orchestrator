#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend

# Fix store.ts syntax/duplicates
sed -i '175d' src/store.ts

npm install --legacy-peer-deps
npm test
