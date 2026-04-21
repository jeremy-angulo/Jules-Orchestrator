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

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    user_id INTEGER,
    user_email TEXT,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip TEXT
  );

  CREATE TABLE IF NOT EXISTS dashboard_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    metric_key TEXT NOT NULL,
    metric_value REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp);
  CREATE INDEX IF NOT EXISTS idx_metrics_key_time ON dashboard_metrics (metric_key, timestamp);
`);


// Prepared statements for atomic operations
const insertProjectStmt = db.prepare('INSERT OR IGNORE INTO project_states (project_id) VALUES (?)');
const getProjectStateStmt = db.prepare('SELECT * FROM project_states WHERE project_id = ?');

const lockProjectStmt = db.prepare('UPDATE project_states SET is_locked_for_daily = 1 WHERE project_id = ?');
const unlockProjectStmt = db.prepare('UPDATE project_states SET is_locked_for_daily = 0 WHERE project_id = ?');

const incrementTasksStmt = db.prepare('UPDATE project_states SET active_tasks = active_tasks + 1 WHERE project_id = ?');
const decrementTasksStmt = db.prepare('UPDATE project_states SET active_tasks = MAX(0, active_tasks - 1) WHERE project_id = ?');
const setTasksStmt = db.prepare('UPDATE project_states SET active_tasks = ? WHERE project_id = ?');

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

export async function setActiveTasks(projectId, taskCount) {
  const safeCount = Math.max(0, Number.isFinite(taskCount) ? Math.trunc(taskCount) : 0);
  setTasksStmt.run(safeCount, projectId);
  const state = projectCache.get(projectId) || { is_locked_for_daily: false, active_tasks: 0 };
  state.active_tasks = safeCount;
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

export function getAllProjectStates() {
  return Array.from(projectCache.entries()).map(([projectId, state]) => ({
    projectId,
    is_locked_for_daily: !!state.is_locked_for_daily,
    active_tasks: state.active_tasks
  }));
}

// --- API Usage Tracking ---

const getTokenUsageStmt = db.prepare('SELECT COUNT(*) as total FROM api_calls_log WHERE token = ? AND timestamp >= ?');
const getAgentUsageStmt = db.prepare('SELECT COUNT(*) as total FROM api_calls_log WHERE agent_name = ? AND timestamp >= ?');
const getTotalUsageStmt = db.prepare('SELECT COUNT(*) as total FROM api_calls_log WHERE timestamp >= ?');
const getUsageByAgentStmt = db.prepare('SELECT agent_name as agentName, COUNT(*) as total FROM api_calls_log WHERE timestamp >= ? GROUP BY agent_name ORDER BY total DESC');
const getUsageByTokenStmt = db.prepare('SELECT token, COUNT(*) as total FROM api_calls_log WHERE timestamp >= ? GROUP BY token ORDER BY total DESC');
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

export function getApiUsageSummary24h() {
  const since = get24hAgoTimestamp();
  return {
    total: getTotalUsage24h(),
    byAgent: getUsageByAgentStmt.all(since),
    byToken: getUsageByTokenStmt.all(since)
  };
}

// --- Audit log ---
const insertAuditStmt = db.prepare(`
  INSERT INTO audit_log (timestamp, user_id, user_email, action, target, details, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const listAuditStmt = db.prepare(`
  SELECT id, timestamp, user_id as userId, user_email as userEmail, action, target, details, ip
  FROM audit_log
  WHERE timestamp >= ?
  ORDER BY id DESC
  LIMIT ?
`);

export function recordAuditEvent({ userId = null, userEmail = null, action, target = null, details = null, ip = null }) {
  if (!action) {
    return;
  }
  const safeDetails = details == null ? null : JSON.stringify(details);
  insertAuditStmt.run(Date.now(), userId, userEmail, action, target, safeDetails, ip);
}

export function listAuditEvents(hours = 24, limit = 200) {
  const safeHours = Math.max(1, Number(hours) || 24);
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 200));
  const since = Date.now() - safeHours * 60 * 60 * 1000;
  const rows = listAuditStmt.all(since, safeLimit);
  return rows.map((row) => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null
  }));
}

// --- Dashboard metrics ---
const insertMetricStmt = db.prepare(`
  INSERT INTO dashboard_metrics (timestamp, metric_key, metric_value)
  VALUES (?, ?, ?)
`);

const listMetricsStmt = db.prepare(`
  SELECT timestamp, metric_key as metricKey, metric_value as metricValue
  FROM dashboard_metrics
  WHERE metric_key = ? AND timestamp >= ?
  ORDER BY timestamp ASC
`);

export function recordDashboardMetric(metricKey, metricValue) {
  if (!metricKey) {
    return;
  }
  insertMetricStmt.run(Date.now(), metricKey, Number(metricValue) || 0);
}

export function listDashboardMetrics(metricKey, hours = 24) {
  const safeHours = Math.max(1, Number(hours) || 24);
  const since = Date.now() - safeHours * 60 * 60 * 1000;
  return listMetricsStmt.all(metricKey, since);
}
