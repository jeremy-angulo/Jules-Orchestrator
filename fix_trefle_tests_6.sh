#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend

# Fix workflowId duplicate
sed -i '248,250d' src/App.tsx

# Fix logsText duplicate div
sed -i '584,585d' src/App.tsx
