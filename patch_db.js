import fs from 'fs';

const file = 'src/db/database.js';
let content = fs.readFileSync(file, 'utf8');

const tableCreation = `
// Initialize the table
db.exec(\`
  CREATE TABLE IF NOT EXISTS project_states (
    project_id TEXT PRIMARY KEY,
    is_locked_for_daily BOOLEAN DEFAULT 0,
    active_tasks INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    date TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    calls INTEGER DEFAULT 0,
    UNIQUE(token, date, agent_name)
  );
\`);
`;

content = content.replace(
  /\/\/ Initialize the table\s+db\.exec\(`[\s\S]*?`\);/g,
  tableCreation
);

const newMethods = `
// --- API Usage Tracking ---

const getTodayDate = () => new Date().toISOString().split('T')[0];

const getTokenUsageStmt = db.prepare('SELECT SUM(calls) as total FROM api_usage WHERE token = ? AND date = ?');
const getAgentUsageStmt = db.prepare('SELECT SUM(calls) as total FROM api_usage WHERE agent_name = ? AND date = ?');
const getTotalUsageStmt = db.prepare('SELECT SUM(calls) as total FROM api_usage WHERE date = ?');
const incrementTokenUsageStmt = db.prepare(\`
  INSERT INTO api_usage (token, date, agent_name, calls)
  VALUES (?, ?, ?, 1)
  ON CONFLICT(token, date, agent_name)
  DO UPDATE SET calls = calls + 1
\`);

export function getTokenUsageToday(token) {
  const row = getTokenUsageStmt.get(token, getTodayDate());
  return row && row.total ? row.total : 0;
}

export function getAgentUsageToday(agentName) {
  const row = getAgentUsageStmt.get(agentName, getTodayDate());
  return row && row.total ? row.total : 0;
}

export function getTotalUsageToday() {
  const row = getTotalUsageStmt.get(getTodayDate());
  return row && row.total ? row.total : 0;
}

export function incrementTokenUsage(token, agentName) {
  incrementTokenUsageStmt.run(token, getTodayDate(), agentName);
}
`;

content += newMethods;

fs.writeFileSync(file, content);
console.log('patched database.js');
