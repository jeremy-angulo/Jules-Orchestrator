const fs = require('fs');
const path = process.argv[2];
const patchPath = process.argv[3];
const file = fs.readFileSync(path, 'utf8');
const patch = fs.readFileSync(patchPath, 'utf8');
const search = patch.split('<<<<<<< SEARCH\n')[1].split('\n=======\n')[0];
const replace = patch.split('\n=======\n')[1].split('\n>>>>>>> REPLACE')[0];
fs.writeFileSync(path, file.replace(search, replace));
