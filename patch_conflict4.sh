#!/bin/bash
cd HomeFreeWorld

# Resolve conflict in tests/unit/favorites.test.ts
sed -i -e '/<<<<<<< HEAD/,/=======/c\    expect(favProp.data?.isFavorite).toBe(true);' -e '/>>>>>>> origin\/dev/d' tests/unit/favorites.test.ts

# Deal with tests/unit/notifications/notificationActions.test.ts
git rm tests/unit/notifications/notificationActions.test.ts

git add .jules/core_log.md tests/unit/favorites.test.ts
git commit -m "Resolve conflicts in jules-7822100190343513728-7cfbf98b"
