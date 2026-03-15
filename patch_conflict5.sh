#!/bin/bash
cd HomeFreeWorld

# We will just accept the dev branch for .jules/core_log.md since it's just a log
git checkout origin/dev -- .jules/core_log.md

# Resolve app/actions/communityActions.ts
# Since PR 1533 is the core sweep for data fetching hardening, we'll keep both changes if possible, or prioritize the hardened version. Let's see the diff first.
git diff app/actions/communityActions.ts
