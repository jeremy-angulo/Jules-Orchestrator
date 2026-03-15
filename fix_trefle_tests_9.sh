#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend

# Fix store.ts
sed -i '158,163d' src/store.ts

npm test
