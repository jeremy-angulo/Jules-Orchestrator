import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:orchestrator.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url,
  authToken,
});

async function executeWithRetry(stmt, retries = 5, delay = 500) {
  const normalizedStmt = typeof stmt === 'string' ? stmt : {
    ...stmt,
    args: stmt.args ? stmt.args.map(a => a === undefined ? null : a) : []
  };
  for (let i = 0; i < retries; i++) {
    try {
      return await client.execute(normalizedStmt);
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function batchWithRetry(stmts, mode, retries = 5, delay = 500) {
  const normalizedStmts = stmts.map(stmt => {
    if (typeof stmt === 'string') return stmt;
    return {
      ...stmt,
      args: stmt.args ? stmt.args.map(a => a === undefined ? null : a) : []
    };
  });
  for (let i = 0; i < retries; i++) {
    try {
      return await client.batch(normalizedStmts, mode);
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Helper to initialize tables
export async function initTables() {
  await batchWithRetry([
    `CREATE TABLE IF NOT EXISTS project_states (
      project_id TEXT PRIMARY KEY,
      is_locked_for_daily BOOLEAN DEFAULT 0,
      active_tasks INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS api_calls_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      user_id INTEGER,
      user_email TEXT,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      ip TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS dashboard_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      metric_key TEXT NOT NULL,
      metric_value REAL NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dashboard_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS dashboard_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS projects_config (
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
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      prompt TEXT NOT NULL,
      color TEXT DEFAULT '#3f8cff',
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      agent_id INTEGER,
      mode TEXT NOT NULL DEFAULT 'loop',
      loop_pause_ms INTEGER DEFAULT 300000,
      cron_schedule TEXT,
      wait_for_pr_merge BOOLEAN DEFAULT 0,
      enabled BOOLEAN DEFAULT 1,
      last_run_at INTEGER,
      total_runs INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      custom_prompt TEXT,
      FOREIGN KEY (project_id) REFERENCES projects_config(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      is_initial BOOLEAN DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS service_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      ok BOOLEAN NOT NULL,
      response_ms INTEGER,
      error_message TEXT,
      timestamp INTEGER NOT NULL,
      source TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS token_names (
      token_index INTEGER PRIMARY KEY,
      custom_name TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      assignment_id INTEGER,
      project_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    )`
  ], "write");

  // Migration: Ensure tables match the expected schema
  const migrations = [
    "ALTER TABLE service_checks ADD COLUMN service TEXT",
    "ALTER TABLE service_checks ADD COLUMN source TEXT",
    "ALTER TABLE service_checks ADD COLUMN error_message TEXT",
    "ALTER TABLE agent_sessions ADD COLUMN started_at INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN created_at INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN ended_at INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN status TEXT DEFAULT 'running'"
  ];

  for (const sql of migrations) {
    try {
      await client.execute(sql);
      console.log(`[Database] Migration success: ${sql}`);
    } catch (e) {
      // Ignore errors (like column already exists)
    }
  }
}

// Basic CRUD
export async function initProjectState(projectId) {
  await executeWithRetry({ sql: 'INSERT OR IGNORE INTO project_states (project_id) VALUES (?)', args: [projectId] });
}
export async function lockProject(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET is_locked_for_daily = 1 WHERE project_id = ?', args: [projectId] });
}
export async function unlockProject(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET is_locked_for_daily = 0 WHERE project_id = ?', args: [projectId] });
}
export async function incrementTasks(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = active_tasks + 1 WHERE project_id = ?', args: [projectId] });
}
export async function decrementTasks(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = MAX(0, active_tasks - 1) WHERE project_id = ?', args: [projectId] });
}
export async function setActiveTasks(projectId, taskCount) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = ? WHERE project_id = ?', args: [taskCount, projectId] });
}
export async function isProjectLocked(projectId) {
  const rs = await executeWithRetry({ sql: 'SELECT is_locked_for_daily FROM project_states WHERE project_id = ?', args: [projectId] });
  return rs.rows[0]?.is_locked_for_daily === 1;
}
export async function getActiveTasks(projectId) {
  const rs = await executeWithRetry({ sql: 'SELECT active_tasks FROM project_states WHERE project_id = ?', args: [projectId] });
  return Number(rs.rows[0]?.active_tasks || 0);
}
export async function getAllProjectStates() {
  const rs = await executeWithRetry('SELECT * FROM project_states');
  return rs.rows.map(r => ({ projectId: r.project_id, is_locked_for_daily: !!r.is_locked_for_daily, active_tasks: Number(r.active_tasks) }));
}

// API usage
export async function recordApiCall(token, agentName) {
  await executeWithRetry({ sql: 'INSERT INTO api_calls_log (token, agent_name, timestamp) VALUES (?, ?, ?)', args: [token, agentName, Date.now()] });
}
export async function getApiUsageSummary24h() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const total = await executeWithRetry({ sql: 'SELECT COUNT(*) as c FROM api_calls_log WHERE timestamp >= ?', args: [since] });
  const byAgent = await executeWithRetry({ sql: 'SELECT agent_name as agentName, COUNT(*) as total FROM api_calls_log WHERE timestamp >= ? GROUP BY agent_name ORDER BY total DESC', args: [since] });
  const byToken = await executeWithRetry({ sql: 'SELECT token, COUNT(*) as total FROM api_calls_log WHERE timestamp >= ? GROUP BY token ORDER BY total DESC', args: [since] });
  return { total: Number(total.rows[0].c), byAgent: byAgent.rows.map(r => ({ agentName: r.agentName, total: Number(r.total) })), byToken: byToken.rows.map(r => ({ token: r.token, total: Number(r.total) })) };
}

// Service checks
export async function recordServiceCheck(serviceId, ok, { statusCode = 200, responseMs = 0, errorMessage = null, source = 'monitor' } = {}) {
  await executeWithRetry({ sql: 'INSERT INTO service_checks (service, ok, response_ms, error_message, timestamp, source) VALUES (?, ?, ?, ?, ?, ?)', args: [serviceId, ok ? 1 : 0, responseMs, errorMessage, Date.now(), source] });
}
export async function recordServiceError(serviceId, error, source = 'monitor') {
  const sourceStr = typeof source === 'object' && source !== null ? JSON.stringify(source) : String(source);
  await recordServiceCheck(serviceId, false, { errorMessage: String(error), source: sourceStr });
}
export async function listServiceChecks(serviceId, limit = 50) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM service_checks WHERE service = ? ORDER BY id DESC LIMIT ?', args: [serviceId, limit] });
  return rs.rows;
}
export async function getServiceErrorSummary(serviceId, hours = 24) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const rs = await executeWithRetry({ sql: 'SELECT COUNT(*) as c FROM service_checks WHERE service = ? AND ok = 0 AND timestamp >= ?', args: [serviceId, since] });
  return { serviceId, errors: Number(rs.rows[0].c), windowHours: hours };
}
export async function listServiceErrors(serviceId, hours = 24, limit = 50) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const rs = await executeWithRetry({ sql: 'SELECT * FROM service_checks WHERE service = ? AND ok = 0 AND timestamp >= ? ORDER BY id DESC LIMIT ?', args: [serviceId, since, limit] });
  return rs.rows;
}
export async function getServiceUptime(serviceId, hours = 24) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const total = await executeWithRetry({ sql: 'SELECT COUNT(*) as c FROM service_checks WHERE service = ? AND timestamp >= ?', args: [serviceId, since] });
  const ok = await executeWithRetry({ sql: 'SELECT COUNT(*) as c FROM service_checks WHERE service = ? AND ok = 1 AND timestamp >= ?', args: [serviceId, since] });
  const count = Number(total.rows[0].c);
  return { uptimePercent: count === 0 ? 100 : (Number(ok.rows[0].c) / count) * 100 };
}

// Audit & Metrics
export async function recordAuditEvent(evt) {
  await executeWithRetry({ sql: 'INSERT INTO audit_log (timestamp, user_id, user_email, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [Date.now(), evt.userId, evt.userEmail, evt.action, evt.target, evt.details ? JSON.stringify(evt.details) : null, evt.ip] });
}
export async function listAuditEvents(hours = 24, limit = 200) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM audit_log WHERE timestamp >= ? ORDER BY id DESC LIMIT ?', args: [Date.now() - (hours * 3600000), limit] });
  return rs.rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}
export async function recordDashboardMetric(key, val) {
  await executeWithRetry({ sql: 'INSERT INTO dashboard_metrics (timestamp, metric_key, metric_value) VALUES (?, ?, ?)', args: [Date.now(), key, val] });
}
export async function listDashboardMetrics(key, hours = 24) {
  const rs = await executeWithRetry({ sql: 'SELECT timestamp, metric_value as value FROM dashboard_metrics WHERE metric_key = ? AND timestamp >= ? ORDER BY timestamp ASC', args: [key, Date.now() - (hours * 3600000)] });
  return rs.rows;
}

// Tokens
export async function listTokenNames() {
  const rs = await executeWithRetry('SELECT * FROM token_names');
  return rs.rows;
}
export async function getTokenName(idx) {
  const rs = await executeWithRetry({ sql: 'SELECT custom_name FROM token_names WHERE token_index = ?', args: [idx] });
  return rs.rows[0]?.custom_name || null;
}
export async function upsertTokenName(idx, name) {
  await executeWithRetry({ sql: 'INSERT INTO token_names (token_index, custom_name) VALUES (?, ?) ON CONFLICT(token_index) DO UPDATE SET custom_name = excluded.custom_name', args: [idx, name] });
}
export async function getTokenUsage24h(token) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const rs = await executeWithRetry({ sql: 'SELECT COUNT(*) as total FROM api_calls_log WHERE token = ? AND timestamp >= ?', args: [token, since] });
  return Number(rs.rows[0]?.total || 0);
}

// Users & Auth
export async function hasAnyDashboardUser() {
  const rs = await executeWithRetry('SELECT COUNT(*) as c FROM dashboard_users');
  return Number(rs.rows[0].c) > 0;
}
export async function findUserByEmail(email) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM dashboard_users WHERE email = ?', args: [email] });
  return rs.rows[0];
}
export async function findUserById(id) {
  const rs = await executeWithRetry({ sql: 'SELECT id, email, role, created_at, last_login_at FROM dashboard_users WHERE id = ?', args: [id] });
  return rs.rows[0];
}
export async function createDashboardUser(email, hash, role) {
  await executeWithRetry({ sql: 'INSERT INTO dashboard_users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)', args: [email, hash, role, Date.now()] });
}
export async function createDashboardSession(uid, hash, exp) {
  await executeWithRetry({ sql: 'INSERT INTO dashboard_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)', args: [uid, hash, exp, Date.now()] });
}
export async function findSessionWithUser(hash) {
  const rs = await executeWithRetry({ sql: 'SELECT s.*, u.email, u.role, u.last_login_at FROM dashboard_sessions s JOIN dashboard_users u ON u.id = s.user_id WHERE s.token_hash = ?', args: [hash] });
  return rs.rows[0];
}
export async function deleteDashboardSession(hash) {
  await executeWithRetry({ sql: 'DELETE FROM dashboard_sessions WHERE token_hash = ?', args: [hash] });
}
export async function deleteExpiredSessions() {
  await executeWithRetry({ sql: 'DELETE FROM dashboard_sessions WHERE expires_at < ?', args: [Date.now()] });
}
export async function listDashboardUsers() {
  const rs = await executeWithRetry('SELECT id, email, role, created_at, last_login_at FROM dashboard_users ORDER BY id ASC');
  return rs.rows;
}
export async function updateDashboardUserRole(id, role) {
  await executeWithRetry({ sql: 'UPDATE dashboard_users SET role = ? WHERE id = ?', args: [role, id] });
}
export async function updateDashboardUserPassword(id, hash) {
  await executeWithRetry({ sql: 'UPDATE dashboard_users SET password_hash = ? WHERE id = ?', args: [hash, id] });
}
export async function deleteDashboardUser(id) {
  await executeWithRetry({ sql: 'DELETE FROM dashboard_users WHERE id = ?', args: [id] });
}

// Agents
export async function listAgents() {
  const rs = await executeWithRetry('SELECT * FROM agents ORDER BY sort_order ASC, name ASC');
  return rs.rows;
}
export async function getAgent(id) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM agents WHERE id = ?', args: [id] });
  return rs.rows[0];
}
export async function createAgent(a) {
  let rs;
  if (a.id) {
    rs = await executeWithRetry({ sql: 'INSERT INTO agents (id, name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [a.id, a.name, a.description, a.prompt, a.color, a.sort_order || 0, Date.now(), Date.now()] });
  } else {
    rs = await executeWithRetry({ sql: 'INSERT INTO agents (name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [a.name, a.description, a.prompt, a.color, a.sort_order || 0, Date.now(), Date.now()] });
  }
  return rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : (a.id || null);
}
export async function updateAgent(id, a) {
  await executeWithRetry({ sql: 'UPDATE agents SET name=?, description=?, prompt=?, color=?, updated_at=? WHERE id=?', args: [a.name, a.description, a.prompt, a.color, Date.now(), id] });
}
export async function deleteAgent(id) {
  await executeWithRetry({ sql: 'DELETE FROM agents WHERE id = ?', args: [id] });
}
export async function reorderAgents(ids) {
  for (let i = 0; i < ids.length; i++) {
    await executeWithRetry({ sql: 'UPDATE agents SET sort_order = ? WHERE id = ?', args: [i, ids[i]] });
  }
}

// Projects
export async function listProjectsConfig() {
  const rs = await executeWithRetry('SELECT * FROM projects_config ORDER BY id ASC');
  return rs.rows;
}
export async function getProjectConfig(id) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM projects_config WHERE id = ?', args: [id] });
  return rs.rows[0];
}
export async function upsertProjectConfig(p) {
  await executeWithRetry({ sql: 'INSERT INTO projects_config (id, github_repo, github_branch, github_token, pipeline_cron, pipeline_source_branch, pipeline_target_branch, pipeline_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET github_repo=excluded.github_repo, github_branch=excluded.github_branch, updated_at=excluded.updated_at', args: [p.id, p.github_repo, p.github_branch || 'main', p.github_token, p.pipeline_cron, p.pipeline_source_branch, p.pipeline_target_branch, p.pipeline_prompt, Date.now(), Date.now()] });
}
export async function deleteProjectConfig(id) {
  await executeWithRetry({ sql: 'DELETE FROM projects_config WHERE id = ?', args: [id] });
}

// Assignments
export async function listAssignments(pid = null) {
  const sql = `
    SELECT a.*, ag.name as agent_name, ag.color as agent_color 
    FROM assignments a 
    LEFT JOIN agents ag ON a.agent_id = ag.id
    ${pid ? 'WHERE a.project_id = ?' : ''}
    ORDER BY a.created_at ASC
  `;
  const q = pid ? { sql, args: [pid] } : { sql, args: [] };
  const rs = await executeWithRetry(q);
  return rs.rows;
}
export async function getAssignment(id) {
  const rs = await executeWithRetry({ 
    sql: `
      SELECT a.*, ag.name as agent_name, ag.color as agent_color 
      FROM assignments a 
      LEFT JOIN agents ag ON a.agent_id = ag.id 
      WHERE a.id = ?
    `, 
    args: [id] 
  });
  return rs.rows[0];
}
export async function createAssignment(a) {
  const rs = await executeWithRetry({ sql: 'INSERT INTO assignments (project_id, agent_id, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge, enabled, created_at, updated_at, custom_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [a.project_id, a.agent_id, a.mode, a.loop_pause_ms, a.cron_schedule, a.wait_for_pr_merge ? 1 : 0, a.enabled !== undefined ? (a.enabled ? 1 : 0) : 1, Date.now(), Date.now(), a.custom_prompt] });
  return rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : null;
}
export async function updateAssignment(id, a) {
  await executeWithRetry({ sql: 'UPDATE assignments SET agent_id=?, custom_prompt=?, mode=?, loop_pause_ms=?, cron_schedule=?, wait_for_pr_merge=?, enabled=?, updated_at=? WHERE id=?', args: [a.agent_id, a.custom_prompt, a.mode, a.loop_pause_ms, a.cron_schedule, a.wait_for_pr_merge ? 1 : 0, a.enabled ? 1 : 0, Date.now(), id] });
}
export async function deleteAssignment(id) {
  await executeWithRetry({ sql: 'DELETE FROM assignments WHERE id = ?', args: [id] });
}
export async function deleteAssignmentsByProject(pid) {
  await executeWithRetry({ sql: 'DELETE FROM assignments WHERE project_id = ?', args: [pid] });
}
export async function toggleAssignment(id, enabled) {
  await executeWithRetry({ sql: 'UPDATE assignments SET enabled = ?, updated_at = ? WHERE id = ?', args: [enabled ? 1 : 0, Date.now(), id] });
}
export async function recordAssignmentRun(id) {
  await executeWithRetry({ sql: 'UPDATE assignments SET last_run_at = ?, total_runs = total_runs + 1 WHERE id = ?', args: [Date.now(), id] });
}

// Prompts
export async function listPromptsByProject(pid) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM prompts WHERE project_id = ?', args: [pid] });
  return rs.rows;
}
export async function getPrompt(pid, name) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM prompts WHERE project_id = ? AND name = ?', args: [pid, name] });
  return rs.rows[0];
}
export async function upsertPrompt(pid, name, content, { source = 'manual', isInitial = false } = {}) {
  await executeWithRetry({ sql: 'INSERT INTO prompts (project_id, name, content, source, is_initial, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, name) DO UPDATE SET content=excluded.content, source=excluded.source, updated_at=excluded.updated_at', args: [pid, name, content, source, isInitial ? 1 : 0, Date.now(), Date.now()] });
}

// Sessions
export async function recordAgentSessionStart({ assignmentId, projectId, agentName, sessionId }) {
  const now = Date.now();
  await executeWithRetry({ 
    sql: 'INSERT INTO agent_sessions (session_id, assignment_id, project_id, agent_name, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', 
    args: [sessionId, assignmentId, projectId, agentName, now, now] 
  });
}
export async function recordAgentSessionEnd(sid, status) {
  await executeWithRetry({ sql: 'UPDATE agent_sessions SET status = ?, ended_at = ? WHERE session_id = ?', args: [status, Date.now(), sid] });
}
export async function listAgentSessions(pid) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50', args: [pid] });
  return rs.rows;
}
export async function getLastAgentSession(aid) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM agent_sessions WHERE assignment_id = ? ORDER BY started_at DESC LIMIT 1', args: [aid] });
  return rs.rows[0];
}
