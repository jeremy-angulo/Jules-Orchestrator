import fs from 'fs';
import path from 'path';

const testDir = 'tests';
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));

for (const file of files) {
  const filePath = path.join(testDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Inject JULES_MAIN_TOKEN in tests
  if (content.includes('GLOBAL_CONFIG.JULES_API_TOKEN')) {
      content = content.replace(/GLOBAL_CONFIG\.JULES_API_TOKEN\s*=\s*'[^']*';?/g, "GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';");
  } else {
      // Add it to the top if not present but GLOBAL_CONFIG is imported
      if (content.includes('import { GLOBAL_CONFIG } from')) {
          content = content.replace(
            /(import \{ GLOBAL_CONFIG \}.*)/,
            "$1\nGLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';\nGLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];"
          );
      }
  }

  // Handle startAndMonitorSession mocked calls. It now requires agentName before project
  if (content.includes('startAndMonitorSession(') && !filePath.includes('julesClient.test.js')) {
      // Very basic regex replacements for tests mocking startAndMonitorSession
      // where it's called with instruction, "agentName", project. This isn't strictly needed for tests calling it
      // unless the mock itself is checking the number of arguments or the agent name directly.
  }

  fs.writeFileSync(filePath, content);
}

console.log('patched tests');
