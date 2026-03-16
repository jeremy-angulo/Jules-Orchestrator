#!/bin/bash
cd /app/HomeFreeWorld

# Line 47 is `     }]);`. It should be `    });`.
sed -i 's/ }\]);/    });/g' app/actions/contractActions.ts

npm test
