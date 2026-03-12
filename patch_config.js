import fs from 'fs';

const file = 'src/config.js';
let content = fs.readFileSync(file, 'utf8');

// Replace JULES_API_TOKEN with main and secondary tokens
content = content.replace(
  /JULES_API_TOKEN:\s*process\.env\.JULES_API_TOKEN,/,
  `JULES_MAIN_TOKEN: process.env.JULES_MAIN_TOKEN,
  JULES_SECONDARY_TOKENS: process.env.JULES_SECONDARY_TOKENS ? process.env.JULES_SECONDARY_TOKENS.split(',').map(t => t.trim()) : [],`
);

fs.writeFileSync(file, content);
console.log('patched config.js');
