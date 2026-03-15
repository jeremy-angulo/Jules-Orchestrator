#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
cat -n src/App.tsx | grep -C 10 "logsText" | tail -n 25
