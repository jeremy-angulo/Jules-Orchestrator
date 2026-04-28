import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.ORCHESTRATOR_DB_PATH || 'orchestrator.db';

// Bootstrap logic: If DB_PATH doesn't exist but a seed.db exists in the app root, copy it.
// This allows migrating from local/fly to Render by just pushing a seed.db once.
if (!fs.existsSync(DB_PATH)) {
  console.log(`[Database] Target database not found at ${DB_PATH}. Checking for seed...`);
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir) && dbDir !== '.') {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync('seed.db')) {
    console.log('[Database] Found seed.db! Copying to persistent volume...');
    fs.copyFileSync('seed.db', DB_PATH);
  } else {
    console.log('[Database] No seed.db found. Starting with a fresh database.');
  }
}

const db = new Database(DB_PATH);
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

  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    prompt_name TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    is_initial INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    UNIQUE (project_id, prompt_name)
  );

  CREATE TABLE IF NOT EXISTS service_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    service TEXT NOT NULL,
    ok INTEGER NOT NULL,
    status_code INTEGER,
    response_ms INTEGER
  );

  CREATE TABLE IF NOT EXISTS service_error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    service TEXT NOT NULL,
    code TEXT,
    message TEXT NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS token_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_index INTEGER NOT NULL UNIQUE,
    custom_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp);
  CREATE INDEX IF NOT EXISTS idx_metrics_key_time ON dashboard_metrics (metric_key, timestamp);
  CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts (project_id, prompt_name);
  CREATE INDEX IF NOT EXISTS idx_service_checks_service_time ON service_checks (service, timestamp);
  CREATE INDEX IF NOT EXISTS idx_service_error_service_time ON service_error_log (service, timestamp);
  CREATE INDEX IF NOT EXISTS idx_token_names_index ON token_names (token_index);
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

const upsertPromptStmt = db.prepare(`
  INSERT INTO prompts (project_id, prompt_name, content, source, is_initial, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(project_id, prompt_name)
  DO UPDATE SET
    content = excluded.content,
    source = excluded.source,
    is_initial = excluded.is_initial,
    updated_at = excluded.updated_at
`);

const getPromptStmt = db.prepare(`
  SELECT project_id as projectId, prompt_name as promptName, content, source, is_initial as isInitial, updated_at as updatedAt
  FROM prompts
  WHERE project_id = ? AND prompt_name = ?
  LIMIT 1
`);

const listPromptsByProjectStmt = db.prepare(`
  SELECT project_id as projectId, prompt_name as promptName, content, source, is_initial as isInitial, updated_at as updatedAt
  FROM prompts
  WHERE project_id = ?
  ORDER BY prompt_name ASC
`);

const insertServiceCheckStmt = db.prepare(`
  INSERT INTO service_checks (timestamp, service, ok, status_code, response_ms)
  VALUES (?, ?, ?, ?, ?)
`);

const insertServiceErrorStmt = db.prepare(`
  INSERT INTO service_error_log (timestamp, service, code, message, details)
  VALUES (?, ?, ?, ?, ?)
`);

const listServiceErrorsStmt = db.prepare(`
  SELECT id, timestamp, service, code, message, details
  FROM service_error_log
  WHERE service = ? AND timestamp >= ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const countServiceErrorsStmt = db.prepare(`
  SELECT COUNT(*) as total
  FROM service_error_log
  WHERE service = ? AND timestamp >= ?
`);

const listServiceChecksStmt = db.prepare(`
  SELECT id, timestamp, service, ok, status_code as statusCode, response_ms as responseMs
  FROM service_checks
  WHERE service = ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const countServiceChecksStmt = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) as okTotal
  FROM service_checks
  WHERE service = ? AND timestamp >= ?
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

export function upsertPrompt(projectId, promptName, content, options = {}) {
  const safeProjectId = String(projectId || '').trim();
  const safePromptName = String(promptName || '').trim();
  const safeContent = String(content || '');
  if (!safeProjectId || !safePromptName) {
    return false;
  }

  const source = String(options.source || 'manual');
  const isInitial = options.isInitial ? 1 : 0;
  upsertPromptStmt.run(safeProjectId, safePromptName, safeContent, source, isInitial, Date.now());
  return true;
}

export function getPrompt(projectId, promptName) {
  const safeProjectId = String(projectId || '').trim();
  const safePromptName = String(promptName || '').trim();
  if (!safeProjectId || !safePromptName) {
    return null;
  }
  return getPromptStmt.get(safeProjectId, safePromptName) || null;
}

export function listPromptsByProject(projectId) {
  const safeProjectId = String(projectId || '').trim();
  if (!safeProjectId) {
    return [];
  }
  return listPromptsByProjectStmt.all(safeProjectId);
}

export function recordServiceCheck(service, ok, details = {}) {
  const safeService = String(service || '').trim();
  if (!safeService) {
    return;
  }
  const responseMs = Number.isFinite(details.responseMs) ? Math.max(0, Math.round(details.responseMs)) : null;
  const statusCode = Number.isFinite(details.statusCode) ? Math.round(details.statusCode) : null;
  insertServiceCheckStmt.run(Date.now(), safeService, ok ? 1 : 0, statusCode, responseMs);
}

export function recordServiceError(service, message, details = {}) {
  const safeService = String(service || '').trim();
  const safeMessage = String(message || '').trim();
  if (!safeService || !safeMessage) {
    return;
  }
  const code = details.code == null ? null : String(details.code);
  const payload = details == null ? null : JSON.stringify(details);
  insertServiceErrorStmt.run(Date.now(), safeService, code, safeMessage, payload);
}

export function listServiceErrors(service, hours = 24, limit = 50) {
  const safeService = String(service || '').trim();
  const safeHours = Math.max(1, Number(hours) || 24);
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  if (!safeService) {
    return [];
  }
  const since = Date.now() - safeHours * 60 * 60 * 1000;
  const rows = listServiceErrorsStmt.all(safeService, since, safeLimit);
  return rows.map((row) => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null
  }));
}

export function getServiceErrorSummary(service, hours = 24) {
  const safeService = String(service || '').trim();
  const safeHours = Math.max(1, Number(hours) || 24);
  if (!safeService) {
    return { errors: 0, windowHours: safeHours };
  }
  const since = Date.now() - safeHours * 60 * 60 * 1000;
  const row = countServiceErrorsStmt.get(safeService, since);
  return {
    errors: Number(row?.total || 0),
    windowHours: safeHours
  };
}

export function listServiceChecks(service, limit = 30) {
  const safeService = String(service || '').trim();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 30));
  if (!safeService) {
    return [];
  }
  return listServiceChecksStmt.all(safeService, safeLimit);
}

export function getServiceUptime(service, hours = 24) {
  const safeService = String(service || '').trim();
  const safeHours = Math.max(1, Number(hours) || 24);
  if (!safeService) {
    return { uptimePercent: null, totalChecks: 0 };
  }
  const since = Date.now() - safeHours * 60 * 60 * 1000;
  const row = countServiceChecksStmt.get(safeService, since);
  const total = Number(row?.total || 0);
  const okTotal = Number(row?.okTotal || 0);
  const uptimePercent = total > 0 ? Number(((okTotal / total) * 100).toFixed(1)) : null;
  return {
    uptimePercent,
    totalChecks: total
  };
}

// --- Token names (custom labels) ---
const getTokenNameStmt = db.prepare(`
  SELECT token_index as tokenIndex, custom_name as customName, updated_at as updatedAt
  FROM token_names
  WHERE token_index = ?
  LIMIT 1
`);

const upsertTokenNameStmt = db.prepare(`
  INSERT INTO token_names (token_index, custom_name, created_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(token_index)
  DO UPDATE SET
    custom_name = excluded.custom_name,
    updated_at = excluded.updated_at
`);

const listTokenNamesStmt = db.prepare(`
  SELECT token_index as tokenIndex, custom_name as customName, created_at as createdAt, updated_at as updatedAt
  FROM token_names
  ORDER BY token_index ASC
`);

export function getTokenName(tokenIndex) {
  const safeIndex = Number(tokenIndex) || 0;
  if (!Number.isFinite(safeIndex) || safeIndex < 0) {
    return null;
  }
  return getTokenNameStmt.get(safeIndex) || null;
}

export function upsertTokenName(tokenIndex, customName) {
  const safeIndex = Number(tokenIndex) || 0;
  const safeName = String(customName || '').trim();
  if (!Number.isFinite(safeIndex) || safeIndex < 0 || !safeName) {
    return false;
  }
  const now = Date.now();
  upsertTokenNameStmt.run(safeIndex, safeName, now, now);
  return true;
}

export function listTokenNames() {
  return listTokenNamesStmt.all();
}

// =========================================================
// Agent Library, Projects Config, Assignments
// =========================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3f8cff',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects_config (
    id TEXT PRIMARY KEY,
    github_repo TEXT NOT NULL,
    github_branch TEXT NOT NULL DEFAULT 'main',
    github_token TEXT,
    pipeline_cron TEXT,
    pipeline_source_branch TEXT,
    pipeline_target_branch TEXT,
    pipeline_prompt TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    agent_id INTEGER,
    custom_prompt TEXT,
    mode TEXT NOT NULL CHECK(mode IN ('loop', 'scheduled', 'one-shot')),
    loop_pause_ms INTEGER NOT NULL DEFAULT 300000,
    cron_schedule TEXT,
    wait_for_pr_merge INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    total_runs INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assignments_project ON assignments (project_id);
  CREATE INDEX IF NOT EXISTS idx_assignments_agent ON assignments (agent_id);
`);

// Agent sessions — persisted so we can reconnect after restart
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER,
    project_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'running'
  );
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_assignment ON agent_sessions (assignment_id);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions (project_id);
`);

const insertAgentSessionStmt = db.prepare(
  `INSERT INTO agent_sessions (assignment_id, project_id, agent_name, session_id, started_at, status)
   VALUES (?, ?, ?, ?, ?, 'running')`
);
const updateAgentSessionStmt = db.prepare(
  `UPDATE agent_sessions SET status = ?, ended_at = ? WHERE session_id = ?`
);
const getLastAgentSessionStmt = db.prepare(
  `SELECT * FROM agent_sessions WHERE assignment_id = ? ORDER BY started_at DESC LIMIT 1`
);
const listAgentSessionsStmt = db.prepare(
  `SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`
);

export function recordAgentSessionStart({ assignmentId, projectId, agentName, sessionId }) {
  insertAgentSessionStmt.run(assignmentId ?? null, String(projectId), String(agentName), String(sessionId), Date.now());
}

export function recordAgentSessionEnd(sessionId, status = 'completed') {
  updateAgentSessionStmt.run(status, Date.now(), String(sessionId));
}

export function getLastAgentSession(assignmentId) {
  return getLastAgentSessionStmt.get(Number(assignmentId)) || null;
}

export function listAgentSessions(projectId) {
  return listAgentSessionsStmt.all(String(projectId));
}

// Migration: Ensure custom_prompt column exists
try {
  db.exec(`ALTER TABLE assignments ADD COLUMN custom_prompt TEXT;`);
} catch (e) {
  // Column might already exist
}

// Migration: Ensure sort_order column exists and initialize it
try {
  db.exec(`ALTER TABLE agents ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {
  // Column might already exist, ignore error
}

db.exec(`
  UPDATE agents SET sort_order = id WHERE sort_order = 0;
`);

// --- Agents ---
const listAgentsStmt = db.prepare('SELECT * FROM agents ORDER BY sort_order ASC, name ASC');
const getAgentStmt = db.prepare('SELECT * FROM agents WHERE id = ?');
const insertAgentStmt = db.prepare(
  'INSERT INTO agents (name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const updateAgentStmt = db.prepare(
  'UPDATE agents SET name = ?, description = ?, prompt = ?, color = ?, sort_order = ?, updated_at = ? WHERE id = ?'
);
const deleteAgentStmt = db.prepare('DELETE FROM agents WHERE id = ?');

export function listAgents() {
  return listAgentsStmt.all();
}

export function getAgent(id) {
  return getAgentStmt.get(Number(id)) || null;
}

export function createAgent({ name, description = '', prompt, color = '#3f8cff', sort_order }) {
  const now = Date.now();
  
  let order = Number(sort_order);
  if (sort_order === undefined) {
    const row = db.prepare('SELECT MAX(sort_order) as maxOrder FROM agents').get();
    order = (row?.maxOrder ?? 0) + 1;
  }

  const result = insertAgentStmt.run(
    String(name || '').trim(),
    String(description || ''),
    String(prompt || ''),
    String(color || '#3f8cff'),
    order,
    now,
    now
  );
  return getAgentStmt.get(result.lastInsertRowid);
}

export function updateAgent(id, { name, description, prompt, color, sort_order }) {
  const existing = getAgentStmt.get(Number(id));
  if (!existing) return null;
  const now = Date.now();
  updateAgentStmt.run(
    String(name ?? existing.name).trim(),
    String(description ?? existing.description),
    String(prompt ?? existing.prompt),
    String(color ?? existing.color),
    Number(sort_order ?? existing.sort_order),
    now,
    Number(id)
  );
  return getAgentStmt.get(Number(id));
}

export function reorderAgents(orderedIds) {
  const updateOrder = db.prepare('UPDATE agents SET sort_order = ? WHERE id = ?');
  const transaction = db.transaction((ids) => {
    ids.forEach((id, index) => {
      updateOrder.run(index, Number(id));
    });
  });
  transaction(orderedIds);
  return true;
}

export function deleteAgent(id) {
  deleteAgentStmt.run(Number(id));
}

// --- Projects Config ---
const listProjectsConfigStmt = db.prepare('SELECT * FROM projects_config ORDER BY id ASC');
const getProjectConfigStmt = db.prepare('SELECT * FROM projects_config WHERE id = ?');
const upsertProjectConfigStmt = db.prepare(`
  INSERT INTO projects_config (id, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    github_repo = excluded.github_repo,
    github_branch = excluded.github_branch,
    github_token = excluded.github_token,
    pipeline_cron = excluded.pipeline_cron,
    pipeline_prompt = excluded.pipeline_prompt,
    updated_at = excluded.updated_at
`);
const deleteProjectConfigStmt = db.prepare('DELETE FROM projects_config WHERE id = ?');

export function listProjectsConfig() {
  return listProjectsConfigStmt.all();
}

export function getProjectConfig(id) {
  return getProjectConfigStmt.get(String(id || '')) || null;
}

export function upsertProjectConfig({ id, github_repo, github_branch = 'main', github_token = null, pipeline_cron = null, pipeline_prompt = null }) {
  const now = Date.now();
  const existing = getProjectConfigStmt.get(String(id || ''));
  upsertProjectConfigStmt.run(
    String(id || '').trim(),
    String(github_repo || ''),
    String(github_branch || 'main'),
    github_token ? String(github_token) : null,
    pipeline_cron ? String(pipeline_cron) : null,
    pipeline_prompt ? String(pipeline_prompt) : null,
    existing ? existing.created_at : now,
    now
  );
  return getProjectConfigStmt.get(String(id || ''));
}

export function deleteProjectConfig(id) {
  deleteProjectConfigStmt.run(String(id || ''));
}

// --- Assignments ---
const _assignmentSelectSQL = `
  SELECT a.*, ag.name as agent_name, ag.description as agent_description, ag.color as agent_color
  FROM assignments a LEFT JOIN agents ag ON a.agent_id = ag.id
`;
const listAssignmentsStmt = db.prepare(`${_assignmentSelectSQL} ORDER BY a.created_at DESC`);
const listAssignmentsByProjectStmt = db.prepare(`${_assignmentSelectSQL} WHERE a.project_id = ? ORDER BY a.created_at DESC`);
const getAssignmentStmt = db.prepare(`${_assignmentSelectSQL} WHERE a.id = ?`);
const insertAssignmentStmt = db.prepare(`
  INSERT INTO assignments (project_id, agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
const updateAssignmentStmt = db.prepare(`
  UPDATE assignments SET agent_id = ?, custom_prompt = ?, mode = ?, loop_pause_ms = ?, cron_schedule = ?, wait_for_pr_merge = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`);
const deleteAssignmentStmt = db.prepare('DELETE FROM assignments WHERE id = ?');
const deleteAssignmentsByProjectStmt = db.prepare('DELETE FROM assignments WHERE project_id = ?');
const recordAssignmentRunStmt = db.prepare(
  'UPDATE assignments SET last_run_at = ?, total_runs = total_runs + 1, updated_at = ? WHERE id = ?'
);
const toggleAssignmentStmt = db.prepare('UPDATE assignments SET enabled = ?, updated_at = ? WHERE id = ?');

export function listAssignments(projectId = null) {
  if (projectId) return listAssignmentsByProjectStmt.all(String(projectId));
  return listAssignmentsStmt.all();
}

export function getAssignment(id) {
  return getAssignmentStmt.get(Number(id)) || null;
}

export function createAssignment({ project_id, agent_id, custom_prompt, mode, loop_pause_ms = 300000, cron_schedule = null, wait_for_pr_merge = false }) {
  const now = Date.now();
  const result = insertAssignmentStmt.run(
    String(project_id),
    agent_id ? Number(agent_id) : null,
    custom_prompt ? String(custom_prompt) : null,
    String(mode),
    Math.max(60000, Number(loop_pause_ms) || 300000),
    cron_schedule ? String(cron_schedule) : null,
    wait_for_pr_merge ? 1 : 0,
    now,
    now
  );
  return getAssignmentStmt.get(result.lastInsertRowid);
}

export function updateAssignment(id, { agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge, enabled } = {}) {
  const existing = getAssignmentStmt.get(Number(id));
  if (!existing) return null;
  const now = Date.now();
  updateAssignmentStmt.run(
    (agent_id !== undefined) ? (agent_id ? Number(agent_id) : null) : existing.agent_id,
    (custom_prompt !== undefined) ? (custom_prompt ? String(custom_prompt) : null) : existing.custom_prompt,
    String(mode ?? existing.mode),
    Math.max(60000, Number(loop_pause_ms ?? existing.loop_pause_ms) || 300000),
    (cron_schedule !== undefined) ? (cron_schedule ? String(cron_schedule) : null) : existing.cron_schedule,
    (wait_for_pr_merge !== undefined) ? (wait_for_pr_merge ? 1 : 0) : existing.wait_for_pr_merge,
    (enabled !== undefined) ? (enabled ? 1 : 0) : existing.enabled,
    now,
    Number(id)
  );
  return getAssignmentStmt.get(Number(id));
}

export function deleteAssignment(id) {
  deleteAssignmentStmt.run(Number(id));
}

export function deleteAssignmentsByProject(projectId) {
  deleteAssignmentsByProjectStmt.run(String(projectId));
}

export function recordAssignmentRun(id) {
  const now = Date.now();
  recordAssignmentRunStmt.run(now, now, Number(id));
}

export function toggleAssignment(id, enabled) {
  const now = Date.now();
  toggleAssignmentStmt.run(enabled ? 1 : 0, now, Number(id));
  return getAssignmentStmt.get(Number(id));
}
