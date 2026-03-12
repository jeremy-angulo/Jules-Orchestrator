import fs from 'fs';
import path from 'path';

const testDir = 'tests';
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));

for (const file of files) {
  const filePath = path.join(testDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Inject GLOBAL_CONFIG import and tokens if not present
  if (!content.includes('import { GLOBAL_CONFIG }')) {
      content = "import { GLOBAL_CONFIG } from '../src/config.js';\n" + content;
      content = content.replace(
        "import { GLOBAL_CONFIG } from '../src/config.js';\n",
        "import { GLOBAL_CONFIG } from '../src/config.js';\nGLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';\nGLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];\n"
      );
      fs.writeFileSync(filePath, content);
  }
}

console.log('patched tests again');
