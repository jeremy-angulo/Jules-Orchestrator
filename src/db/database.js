import Database from 'better-sqlite3';

const db = new Database('orchestrator.db');
db.pragma('journal_mode = WAL');


// Initialize the table
db.exec(`
  CREATE TABLE IF NOT EXISTS project_states (
    project_id TEXT PRIMARY KEY,
    is_locked_for_daily BOOLEAN DEFAULT 0,
    active_tasks INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS api_calls_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);


// Prepared statements for atomic operations
const insertProjectStmt = db.prepare('INSERT OR IGNORE INTO project_states (project_id) VALUES (?)');
const getProjectStateStmt = db.prepare('SELECT * FROM project_states WHERE project_id = ?');

const lockProjectStmt = db.prepare('UPDATE project_states SET is_locked_for_daily = 1 WHERE project_id = ?');
const unlockProjectStmt = db.prepare('UPDATE project_states SET is_locked_for_daily = 0 WHERE project_id = ?');

const incrementTasksStmt = db.prepare('UPDATE project_states SET active_tasks = active_tasks + 1 WHERE project_id = ?');
const decrementTasksStmt = db.prepare('UPDATE project_states SET active_tasks = MAX(0, active_tasks - 1) WHERE project_id = ?');

// In-memory cache for project states to avoid blocking the event loop with synchronous SQLite calls
const projectCache = new Map();

// Initialize cache from database
const allProjects = db.prepare('SELECT * FROM project_states').all();
for (const row of allProjects) {
  projectCache.set(row.project_id, {
    is_locked_for_daily: !!row.is_locked_for_daily,
    active_tasks: row.active_tasks
  });
}

export async function initProjectState(projectId) {
  insertProjectStmt.run(projectId);
  if (!projectCache.has(projectId)) {
    projectCache.set(projectId, { is_locked_for_daily: false, active_tasks: 0 });
  }
}

export async function lockProject(projectId) {
  lockProjectStmt.run(projectId);
  const state = projectCache.get(projectId) || { active_tasks: 0 };
  state.is_locked_for_daily = true;
  projectCache.set(projectId, state);
}

export async function unlockProject(projectId) {
  unlockProjectStmt.run(projectId);
  const state = projectCache.get(projectId) || { active_tasks: 0 };
  state.is_locked_for_daily = false;
  projectCache.set(projectId, state);
}

export async function incrementTasks(projectId) {
  incrementTasksStmt.run(projectId);
  const state = projectCache.get(projectId) || { is_locked_for_daily: false, active_tasks: 0 };
  state.active_tasks++;
  projectCache.set(projectId, state);
}

export async function decrementTasks(projectId) {
  decrementTasksStmt.run(projectId);
  const state = projectCache.get(projectId) || { is_locked_for_daily: false, active_tasks: 0 };
  state.active_tasks = Math.max(0, state.active_tasks - 1);
  projectCache.set(projectId, state);
}

export async function isProjectLocked(projectId) {
  const state = projectCache.get(projectId);
  return state ? state.is_locked_for_daily : false;
}

export async function getActiveTasks(projectId) {
  const state = projectCache.get(projectId);
  return state ? state.active_tasks : 0;
}

// --- API Usage Tracking ---

const getTokenUsageStmt = db.prepare('SELECT COUNT(*) as total FROM api_calls_log WHERE token = ? AND timestamp >= ?');
const getAgentUsageStmt = db.prepare('SELECT COUNT(*) as total FROM api_calls_log WHERE agent_name = ? AND timestamp >= ?');
const getTotalUsageStmt = db.prepare('SELECT COUNT(*) as total FROM api_calls_log WHERE timestamp >= ?');
const recordApiCallStmt = db.prepare(`
  INSERT INTO api_calls_log (token, agent_name, timestamp)
  VALUES (?, ?, ?)
`);

const get24hAgoTimestamp = () => Date.now() - 24 * 60 * 60 * 1000;

export function getTokenUsage24h(token) {
  const row = getTokenUsageStmt.get(token, get24hAgoTimestamp());
  return row && row.total ? row.total : 0;
}

export function getAgentUsage24h(agentName) {
  const row = getAgentUsageStmt.get(agentName, get24hAgoTimestamp());
  return row && row.total ? row.total : 0;
}

export function getTotalUsage24h() {
  const row = getTotalUsageStmt.get(get24hAgoTimestamp());
  return row && row.total ? row.total : 0;
}

export function recordApiCall(token, agentName) {
  recordApiCallStmt.run(token, agentName, Date.now());
}
