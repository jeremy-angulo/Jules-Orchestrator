#!/bin/bash
cd /app/HomeFreeWorld

cat -n app/actions/contractActions.ts | grep -C 10 "Unexpected \"]\""
