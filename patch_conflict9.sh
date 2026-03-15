#!/bin/bash
cd HomeFreeWorld

sed -i -e '/<<<<<<< HEAD/,/=======/c\    if (!session?.user?.id) throw new Error(\"Non autorisé\");\n    const userId = session.user.id;' -e '/>>>>>>> origin\/dev/d' app/actions/propertyActions.ts

git add app/actions/communityActions.ts app/actions/notificationActions.ts app/actions/pdfActions.ts app/actions/propertyActions.ts
git commit -m "Resolve conflicts in core-sweep-data-fetching-hardening-20260316-14400143814645978063"
