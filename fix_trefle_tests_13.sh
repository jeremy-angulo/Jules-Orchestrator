#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
# Let's fix the invalid block.id and block.name/scriptName inside the static "Input CSV" block since it's not inside the map loop.
sed -i '454,472d' src/App.tsx
npm test
