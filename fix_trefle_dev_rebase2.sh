#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
sed -i '246d' src/App.tsx
sed -i '570d' src/App.tsx
npm test
