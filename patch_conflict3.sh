#!/bin/bash
cd HomeFreeWorld

# Fix .jules/core_log.md
sed -i -e '/<<<<<<< HEAD/d' -e '/=======/d' -e '/>>>>>>> origin\/dev/d' .jules/core_log.md

# Fix tests/unit/favorites.test.ts
git diff tests/unit/favorites.test.ts
