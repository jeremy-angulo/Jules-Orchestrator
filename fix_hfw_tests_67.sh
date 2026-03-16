#!/bin/bash
cd /app/HomeFreeWorld

# We still have unexpected characters/syntax errors from previous merges/rebase. Let's fix them.
sed -i 's/   });/    }]);/g' app/actions/contractActions.ts
