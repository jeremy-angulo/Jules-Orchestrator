#!/bin/bash
cd HomeFreeWorld

# Resolve conflict in app/actions/notificationActions.ts
sed -i -e '/<<<<<<< HEAD/,/=======/c\    const [session, validation] = await Promise.all([\n      auth(),\n      notificationIdSchema.safeParseAsync({ notificationId })\n    ]);\n\n    if (!validation.success) {\n      return { success: false, error: validation.error.errors[0].message };\n    }' -e '/>>>>>>> origin\/dev/d' app/actions/notificationActions.ts

git diff app/actions/pdfActions.ts
