#!/bin/bash
cd /app/HomeFreeWorld

sed -i '161,163d' app/actions/contractActions.ts

npm test
