#!/bin/bash
cd HomeFreeWorld

# Fix app/actions/communityActions.ts
sed -i -e '/<<<<<<< HEAD/d' -e '/=======/d' -e '/>>>>>>> origin\/dev/d' app/actions/communityActions.ts

# Fix app/actions/notificationActions.ts
git diff app/actions/notificationActions.ts
