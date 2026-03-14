import fs from 'fs';
let code = fs.readFileSync('src/api/julesClient.js', 'utf8');
code = code.replace(
  /const formattedSourceId = \`sources\/github\/\$\{project\.githubRepo\}\`;/g,
  "const formattedSourceId = `sources/github-${project.githubRepo.replace(/\\//g, '-')}`;"
);
fs.writeFileSync('src/api/julesClient.js', code);
