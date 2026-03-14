import fs from 'fs';
let code = fs.readFileSync('tests/julesClient.test.js', 'utf8');
code = code.replace(
  /'sources\/github\/test\/repo'/g,
  "'sources/github-test-repo'"
);
fs.writeFileSync('tests/julesClient.test.js', code);
