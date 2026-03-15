#!/bin/bash
cd HomeFreeWorld

sed -i -e '/<<<<<<< HEAD/,/=======/c\  if (!session?.user) throw new Error(\"Unauthorized\");\n  bookingIdSchema.parse({ bookingId });\n\n  const booking = await prisma.booking.findUnique({\n    where: { id: bookingId },\n    include: {\n      property: {\n        include: {\n          expenses: true,\n        }\n      },\n      user: true,\n      owner: true,\n    },\n  });' -e '/>>>>>>> origin\/dev/d' app/actions/pdfActions.ts

git diff app/actions/propertyActions.ts
