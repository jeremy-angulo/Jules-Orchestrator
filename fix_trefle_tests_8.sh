#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
sed -i '208d' src/App.tsx
cat -n src/store.ts | grep -C 5 "payload"
