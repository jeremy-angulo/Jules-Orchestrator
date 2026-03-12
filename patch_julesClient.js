import fs from 'fs';

const file = 'src/api/julesClient.js';
let content = fs.readFileSync(file, 'utf8');

// Add imports
content = content.replace(
  "import { checkAndMergePR } from './githubClient.js';",
  "import { checkAndMergePR } from './githubClient.js';\nimport { getAvailableToken, QuotaExceededError } from './tokenRotation.js';\nimport { incrementTokenUsage } from '../db/database.js';"
);

// Update julesAPI
content = content.replace(
  /export async function julesAPI\(endpoint, method = 'GET', body = null, queryParams = null\) \{[\s\S]*?const options = \{[\s\S]*?headers: \{ 'X-Goog-Api-Key': \`\$\{GLOBAL_CONFIG\.JULES_API_TOKEN\}\` \}[\s\S]*?\};/,
  `export async function julesAPI(agentName, endpoint, method = 'GET', body = null, queryParams = null) {
  let url = \`\${JULES_API_BASE}\${endpoint}\`;

  if (queryParams) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        params.append(key, value);
      }
    }
    const queryString = params.toString();
    if (queryString) {
      url += \`?\${queryString}\`;
    }
  }

  // Use dynamic token logic via tokenRotation.js
  const token = getAvailableToken(agentName);

  // Track usage for sessions creation / messages
  if (method === 'POST' && (endpoint === '/sessions' || endpoint.includes(':sendMessage'))) {
    incrementTokenUsage(token, agentName);
  }

  const options = {
    method,
    headers: { 'X-Goog-Api-Key': token }
  };`
);

// Update listSources
content = content.replace(
  /export async function listSources\(pageSize, pageToken, filter\) \{\n\s+return julesAPI\('/,
  "export async function listSources(agentName, pageSize, pageToken, filter) {\n  return julesAPI(agentName, '/"
);

// Update getSource
content = content.replace(
  /export async function getSource\(sourceId\) \{\n\s+const safeId = [\s\S]*?return julesAPI\(/,
  "export async function getSource(agentName, sourceId) {\n  const safeId = sourceId.startsWith('sources/') ? sourceId : `sources/${sourceId}`;\n  return julesAPI(agentName, "
);

// Update createSession
content = content.replace(
  /export async function createSession\(prompt, title, sourceId, startingBranch, automationMode\) \{[\s\S]*?return julesAPI\('\/sessions', 'POST', body\);\n\}/,
  `export async function createSession(agentName, prompt, title, sourceId, startingBranch, automationMode) {
  const body = {
    prompt,
    title,
    sourceContext: {
      source: sourceId.startsWith('sources/') ? sourceId : \`sources/\${sourceId}\`,
      githubRepoContext: {
        startingBranch: startingBranch || 'main'
      }
    }
  };

  if (automationMode) {
    body.automationMode = automationMode;
  }

  return julesAPI(agentName, '/sessions', 'POST', body);
}`
);

// Update listSessions
content = content.replace(
  /export async function listSessions\(pageSize, pageToken\) \{\n\s+return julesAPI\('/,
  "export async function listSessions(agentName, pageSize, pageToken) {\n  return julesAPI(agentName, '/"
);

// Update getSession
content = content.replace(
  /export async function getSession\(sessionId\) \{\n\s+const safeId = [\s\S]*?return julesAPI\(/,
  "export async function getSession(agentName, sessionId) {\n  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;\n  return julesAPI(agentName, "
);

// Update deleteSession
content = content.replace(
  /export async function deleteSession\(sessionId\) \{\n\s+const safeId = [\s\S]*?return julesAPI\(/,
  "export async function deleteSession(agentName, sessionId) {\n  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;\n  return julesAPI(agentName, "
);

// Update sendMessage
content = content.replace(
  /export async function sendMessage\(sessionId, message\) \{\n\s+const safeId = [\s\S]*?return julesAPI\(/,
  "export async function sendMessage(agentName, sessionId, message) {\n  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;\n  return julesAPI(agentName, "
);

// Update approvePlan
content = content.replace(
  /export async function approvePlan\(sessionId\) \{\n\s+const safeId = [\s\S]*?return julesAPI\(/,
  "export async function approvePlan(agentName, sessionId) {\n  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;\n  return julesAPI(agentName, "
);

// Update listActivities
content = content.replace(
  /export async function listActivities\(sessionId, pageSize, pageToken, createTime\) \{\n\s+const safeId = [\s\S]*?return julesAPI\(/,
  "export async function listActivities(agentName, sessionId, pageSize, pageToken, createTime) {\n  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;\n  return julesAPI(agentName, "
);

// Update getActivity
content = content.replace(
  /export async function getActivity\(sessionId, activityId\) \{\n\s+const safeSessionId = [\s\S]*?return julesAPI\(/,
  "export async function getActivity(agentName, sessionId, activityId) {\n  const safeSessionId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;\n  return julesAPI(agentName, "
);

// Update startAndMonitorSession calls
content = content.replace(
  /const session = await createSession\(\n\s+instruction,/,
  "const session = await createSession(\n      agentName,\n      instruction,"
);

content = content.replace(
  /const state = await getSession\(sessionName\);/,
  "const state = await getSession(agentName, sessionName);"
);

fs.writeFileSync(file, content);
console.log('patched julesClient.js');
