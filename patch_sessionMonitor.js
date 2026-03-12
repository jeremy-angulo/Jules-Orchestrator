import fs from 'fs';

const file = 'src/agents/sessionMonitor.js';
let content = fs.readFileSync(file, 'utf8');

// Update listSessions
content = content.replace(
  /const sessionsResponse = await listSessions\(100, pageToken\);/,
  "const sessionsResponse = await listSessions('Session Monitor', 100, pageToken);"
);

// Update approvePlan
content = content.replace(
  /await approvePlan\(session\.name\);/,
  "await approvePlan('Session Monitor', session.name);"
);

// Update sendMessage
content = content.replace(
  /await sendMessage\(session\.name, "keep going"\);/,
  "await sendMessage('Session Monitor', session.name, \"keep going\");"
);

fs.writeFileSync(file, content);
console.log('patched sessionMonitor.js');
