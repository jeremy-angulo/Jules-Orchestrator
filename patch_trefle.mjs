import fs from 'node:fs';
let content = fs.readFileSync('tests/empirical-trefle.test.js', 'utf8');

// Replace top level imports
content = content.replace("import test from 'node:test';", "");
content = `import test from 'node:test';\n` + content;

// Replace main with test definition
content = content.replace(/async function main\(\) \{/g, `test('tests/empirical-trefle.test.js', async () => {`);

// Replace exiting the process
content = content.replace(/process\.exit\(1\);/g, 'throw error;');
content = content.replace(/process\.exit\(0\);/g, 'return;');

// Replace main(); execution at the end with });
content = content.replace(/main\(\);\s*$/, '});');

fs.writeFileSync('tests/empirical-trefle.test.js', content);
