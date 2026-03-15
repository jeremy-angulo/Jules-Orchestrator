#!/bin/bash
cd HomeFreeWorld
sed -i '25,28d' app/actions/notificationActions.ts
sed -i '138,141d' app/actions/notificationActions.ts
npm test
