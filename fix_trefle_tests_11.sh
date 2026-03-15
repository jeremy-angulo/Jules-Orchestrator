#!/bin/bash
cd /app/TrefleAI_IHM/local-app/frontend
sed -i '581,583c\            {useWorkflowStore.getState().logsText || (\n              <div className="text-slate-600 text-center mt-4">No logs yet. Run pipeline to see output.</div>\n            )}' src/App.tsx
npm test
