#!/bin/bash
for PR in 427 426 414 404 403; do
  curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
       -H "Accept: application/vnd.github.v3+json" \
       -d '{"body": "Closing as this PR implements a feature already merged into `dev` in a more recent commit by another agent."}' \
       "https://api.github.com/repos/jeremy-angulo/TrefleAI_IHM/issues/$PR/comments"
done
