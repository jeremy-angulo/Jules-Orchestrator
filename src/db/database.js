import { createClient } from '@libsql/client';

const isTestEnv = process.env.NODE_ENV === 'test';

const dbPath = process.env.ORCHESTRATOR_DB_PATH || (isTestEnv ? 'test-orchestrator.db' : 'orchestrator.db');
const url = (isTestEnv || !process.env.TURSO_DATABASE_URL)
  ? `file:${dbPath}`
  : process.env.TURSO_DATABASE_URL;
const authToken = isTestEnv ? undefined : process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url,
  authToken,
});

// Caches to minimize DB reads (indefinite since we are the sole writer)
const siteCheckStatsCache = new Map(); // projectId -> stats
const siteCheckPagesCache = new Map(); // projectId -> pages
const projectStateCache = new Map(); // projectId -> state
const projectConfigCache = new Map(); // projectId -> config
const agentListCache = { data: null };
const assignmentListCache = new Map(); // projectId (or 'all') -> assignments

function invalidateSiteCheckCache(projectId) {
  if (projectId) {
    siteCheckStatsCache.delete(projectId);
    siteCheckPagesCache.delete(projectId);
  }
}

function invalidateProjectStateCache(projectId) {
  if (projectId) projectStateCache.delete(projectId);
}

function invalidateProjectConfigCache(projectId) {
  if (projectId) projectConfigCache.delete(projectId);
}

function invalidateAgentCache() {
  agentListCache.data = null;
}

function invalidateAssignmentCache(projectId) {
  if (projectId) assignmentListCache.delete(projectId);
  assignmentListCache.delete('all');
}

async function executeWithRetry(stmt, retries = 10, delay = 1000) {
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

async function batchWithRetry(stmts, mode, retries = 10, delay = 1000) {
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
      active_tasks INTEGER DEFAULT 0,
      locked_at INTEGER,
      lock_reason TEXT
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
      enabled BOOLEAN DEFAULT 1,
      last_run_at INTEGER,
      total_runs INTEGER DEFAULT 0,
      concurrency INTEGER DEFAULT 1,
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
    `CREATE TABLE IF NOT EXISTS token_names (
      token_index INTEGER PRIMARY KEY,
      custom_name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
    )`,
    `CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      assignment_id INTEGER,
      project_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      token_index INTEGER,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      assignment_id INTEGER,
      project_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      intent TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      pr_url TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      metadata JSON
    )`
  ], "write");

  // Migration: Ensure tables match the expected schema
  const migrations = [
    "ALTER TABLE agent_sessions ADD COLUMN started_at INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN created_at INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN ended_at INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN status TEXT DEFAULT 'running'",
    "ALTER TABLE agent_sessions ADD COLUMN token_index INTEGER",
    "ALTER TABLE assignments ADD COLUMN concurrency INTEGER DEFAULT 1",
    "ALTER TABLE assignments ADD COLUMN wait_for_pr_merge INTEGER DEFAULT 0",
    "ALTER TABLE token_names ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)",
    "ALTER TABLE project_states ADD COLUMN locked_at INTEGER",
    "ALTER TABLE project_states ADD COLUMN lock_reason TEXT",
    "ALTER TABLE site_pages ADD COLUMN screenshot_path TEXT",
    "ALTER TABLE site_pages ADD COLUMN issues JSON",
    "ALTER TABLE site_pages ADD COLUMN requires_auth BOOLEAN DEFAULT 0",
    "ALTER TABLE site_pages ADD COLUMN requires_admin BOOLEAN DEFAULT 0",
    "ALTER TABLE site_pages ADD COLUMN is_wizard BOOLEAN DEFAULT 0",
    "ALTER TABLE prompts ADD COLUMN prompt_name TEXT",
    "ALTER TABLE token_names ADD COLUMN id INTEGER",
    "ALTER TABLE agent_sessions ADD COLUMN id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_agent_sessions_project   ON agent_sessions(project_id, started_at)",
    "CREATE INDEX IF NOT EXISTS idx_journal_project          ON journal(project_id, started_at)",
    "CREATE INDEX IF NOT EXISTS idx_journal_assignment       ON journal(assignment_id, started_at)",
    "CREATE INDEX IF NOT EXISTS idx_site_pages_pick          ON site_pages(project_id, locked_by, last_screenshot_at, priority)",
    "CREATE INDEX IF NOT EXISTS idx_assignments_project      ON assignments(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_prompts_project          ON prompts(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp      ON audit_log(timestamp)"
  ];

  // Run migrations individually but wrapped in try/catch to ignore "column already exists"
  // Note: PRAGMA user_version could be used for cleaner migrations but this is the current pattern.
  for (const sql of migrations) {
    try {
      await client.execute(sql);
    } catch (e) {
      // Ignore errors like "duplicate column name" or "table already exists"
    }
  }
}

// Prune rows older than N days from high-volume append-only tables.
// Run periodically (e.g. every 6h) to prevent unbounded table growth and full-table scans.
export async function pruneOldData(daysToKeep = 7) {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const results = {};
  const tables = [
    { table: 'audit_log',    col: 'timestamp' },
    { table: 'agent_sessions', col: 'started_at' },
  ];
  for (const { table, col } of tables) {
    try {
      const r = await executeWithRetry({ sql: `DELETE FROM ${table} WHERE ${col} < ?`, args: [cutoff] });
      results[table] = r.rowsAffected;
    } catch (e) {
      results[table] = `error: ${e.message}`;
    }
  }
  return results;
}

// Basic CRUD
export async function initProjectState(projectId) {
  await executeWithRetry({ sql: 'INSERT OR IGNORE INTO project_states (project_id) VALUES (?)', args: [projectId] });
  invalidateProjectStateCache(projectId);
}
export async function lockProject(projectId, reason = 'manual') {
  await executeWithRetry({ sql: 'UPDATE project_states SET is_locked_for_daily = 1, locked_at = ?, lock_reason = ? WHERE project_id = ?', args: [Date.now(), reason, projectId] });
  invalidateProjectStateCache(projectId);
}
export async function unlockProject(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET is_locked_for_daily = 0, locked_at = NULL, lock_reason = NULL WHERE project_id = ?', args: [projectId] });
  invalidateProjectStateCache(projectId);
}
export async function incrementTasks(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = active_tasks + 1 WHERE project_id = ?', args: [projectId] });
  invalidateProjectStateCache(projectId);
}
export async function decrementTasks(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = MAX(0, active_tasks - 1) WHERE project_id = ?', args: [projectId] });
  invalidateProjectStateCache(projectId);
}
export async function setActiveTasks(projectId, taskCount) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = ? WHERE project_id = ?', args: [taskCount, projectId] });
  invalidateProjectStateCache(projectId);
}
export async function isProjectLocked(projectId) {
  const cached = projectStateCache.get(projectId);
  if (cached) return cached.is_locked_for_daily === 1;

  const rs = await executeWithRetry({ sql: 'SELECT * FROM project_states WHERE project_id = ?', args: [projectId] });
  const row = rs.rows[0];
  if (row) projectStateCache.set(projectId, row);
  return row?.is_locked_for_daily === 1;
}
export async function getActiveTasks(projectId) {
  const cached = projectStateCache.get(projectId);
  if (cached) return Number(cached.active_tasks || 0);

  const rs = await executeWithRetry({ sql: 'SELECT * FROM project_states WHERE project_id = ?', args: [projectId] });
  const row = rs.rows[0];
  if (row) projectStateCache.set(projectId, row);
  return Number(row?.active_tasks || 0);
}
export async function getAllProjectStates() {
  const rs = await executeWithRetry('SELECT * FROM project_states');
  const states = rs.rows.map(r => {
    projectStateCache.set(r.project_id, r);
    return { 
      projectId: r.project_id, 
      is_locked_for_daily: !!r.is_locked_for_daily, 
      active_tasks: Number(r.active_tasks),
      lockedAt: r.locked_at,
      lockReason: r.lock_reason
    };
  });
  return states;
}

// Audit
export async function recordAuditEvent(evt) {
  await executeWithRetry({ sql: 'INSERT INTO audit_log (timestamp, user_id, user_email, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [Date.now(), evt.userId, evt.userEmail, evt.action, evt.target, evt.details ? JSON.stringify(evt.details) : null, evt.ip] });
}
export async function listAuditEvents(hours = 24, limit = 200) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM audit_log WHERE timestamp >= ? ORDER BY id DESC LIMIT ?', args: [Date.now() - (hours * 3600000), limit] });
  return rs.rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
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

// ── Site Check ────────────────────────────────────────────────────────────────

export async function getSiteCheckConfig(projectId) {
  const rs = await executeWithRetry({
    sql: 'SELECT site_check_enabled, site_check_base_url, site_check_pause_ms, site_check_locale FROM projects_config WHERE id = ?',
    args: [projectId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    enabled: !!row.site_check_enabled,
    baseUrl: row.site_check_base_url || null,
    pauseMs: Number(row.site_check_pause_ms || 5000),
    locale: row.site_check_locale || 'fr',
  };
}

export async function updateSiteCheckConfig(projectId, { enabled, baseUrl, pauseMs, locale }) {
  await executeWithRetry({
    sql: `UPDATE projects_config
          SET site_check_enabled = ?, site_check_base_url = ?, site_check_pause_ms = ?,
              site_check_locale = ?, updated_at = ?
          WHERE id = ?`,
    args: [enabled ? 1 : 0, baseUrl ?? null, pauseMs ?? 5000, locale ?? 'fr', Date.now(), projectId],
  });
}

// Atomic pick + lock in a single statement — safe for concurrent runners.
// Returns the locked page or null if no unlocked page is available.
export async function pickAndLockSitePage(projectId, agentId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages
          SET locked_by = ?, locked_at = datetime('now')
          WHERE id = (
            SELECT id FROM site_pages
            WHERE project_id = ? AND locked_by IS NULL
            ORDER BY last_screenshot_at ASC NULLS FIRST, priority ASC
            LIMIT 1
          )
          AND locked_by IS NULL
          RETURNING *`,
    args: [agentId, projectId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  invalidateSiteCheckCache(projectId);
  return { ...row, issues: row.issues ? JSON.parse(row.issues) : null };
}

// Kept for external callers; internally prefer pickAndLockSitePage.
export async function lockSitePage(pageId, agentId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages SET locked_by = ?, locked_at = datetime('now') WHERE id = ? AND locked_by IS NULL RETURNING project_id`,
    args: [agentId, pageId],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function unlockSitePage(pageId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages SET locked_by = NULL, locked_at = NULL WHERE id = ? RETURNING project_id`,
    args: [pageId],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function updateSitePageResult(pageId, { status, screenshotPath, issues }) {
  const now = new Date().toISOString();
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages
          SET status = ?, screenshot_path = ?, issues = ?,
              last_screenshot_at = ?, last_analysis_at = ?,
              locked_by = NULL, locked_at = NULL
          WHERE id = ?
          RETURNING project_id`,
    args: [
      status,
      screenshotPath ?? null,
      issues ? JSON.stringify(issues) : null,
      now, now,
      pageId,
    ],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function markSitePageFixed(pageId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages SET status = 'OK', last_correction_at = datetime('now') WHERE id = ? RETURNING project_id`,
    args: [pageId],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function getSiteCheckStats(projectId) {
  const cached = siteCheckStatsCache.get(projectId);
  if (cached) return cached;

  const rs = await executeWithRetry({
    sql: `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END) as ok,
            SUM(CASE WHEN status = 'FIX' THEN 1 ELSE 0 END) as fix,
            SUM(CASE WHEN status = 'ANALYZE' THEN 1 ELSE 0 END) as analyze,
            SUM(CASE WHEN last_screenshot_at IS NULL THEN 1 ELSE 0 END) as never_analyzed
          FROM site_pages WHERE project_id = ?`,
    args: [projectId],
  });
  const row = rs.rows[0];
  const stats = {
    total: Number(row?.total || 0),
    ok: Number(row?.ok || 0),
    fix: Number(row?.fix || 0),
    analyze: Number(row?.analyze || 0),
    neverAnalyzed: Number(row?.never_analyzed || 0),
  };
  siteCheckStatsCache.set(projectId, stats);
  return stats;
}

export async function listSitePages(projectId, { status, group, limit = 100, offset = 0 } = {}) {
  let pages;
  const cached = siteCheckPagesCache.get(projectId);
  if (cached) {
    pages = cached;
  } else {
    const rs = await executeWithRetry({
      sql: `SELECT * FROM site_pages WHERE project_id = ?
            ORDER BY last_screenshot_at ASC NULLS FIRST, priority ASC`,
      args: [projectId],
    });
    pages = rs.rows.map(r => ({ ...r, issues: r.issues ? JSON.parse(r.issues) : null }));
    siteCheckPagesCache.set(projectId, pages);
  }

  let filtered = pages;
  if (status) filtered = filtered.filter(p => p.status === status);
  if (group) filtered = filtered.filter(p => p.group_name === group);

  return filtered.slice(offset, offset + limit);
}

export async function releaseStaleSitePageLocks(maxAgeMinutes = 30) {
  await executeWithRetry({
    sql: `UPDATE site_pages SET locked_by = NULL, locked_at = NULL
          WHERE locked_at < datetime('now', ? || ' minutes')`,
    args: [`-${maxAgeMinutes}`],
  });
  siteCheckStatsCache.clear();
  siteCheckPagesCache.clear();
}

// Agents
export async function listAgents() {
  if (agentListCache.data) return agentListCache.data;
  const rs = await executeWithRetry('SELECT * FROM agents ORDER BY sort_order ASC, name ASC');
  agentListCache.data = rs.rows;
  return rs.rows;
}
export async function getAgent(id) {
  const agents = await listAgents();
  return agents.find(a => String(a.id) === String(id));
}
export async function createAgent(a) {
  let rs;
  if (a.id) {
    rs = await executeWithRetry({ sql: 'INSERT INTO agents (id, name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [a.id, a.name, a.description, a.prompt, a.color, a.sort_order || 0, Date.now(), Date.now()] });
  } else {
    rs = await executeWithRetry({ sql: 'INSERT INTO agents (name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [a.name, a.description, a.prompt, a.color, a.sort_order || 0, Date.now(), Date.now()] });
  }
  invalidateAgentCache();
  return rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : (a.id || null);
}
export async function updateAgent(id, a) {
  await executeWithRetry({ sql: 'UPDATE agents SET name=?, description=?, prompt=?, color=?, updated_at=? WHERE id=?', args: [a.name, a.description, a.prompt, a.color, Date.now(), id] });
  invalidateAgentCache();
}
export async function deleteAgent(id) {
  await executeWithRetry({ sql: 'DELETE FROM agents WHERE id = ?', args: [id] });
  invalidateAgentCache();
}
export async function reorderAgents(ids) {
  for (let i = 0; i < ids.length; i++) {
    await executeWithRetry({ sql: 'UPDATE agents SET sort_order = ? WHERE id = ?', args: [i, ids[i]] });
  }
  invalidateAgentCache();
}

// Projects
export async function listProjectsConfig() {
  const rs = await executeWithRetry('SELECT * FROM projects_config ORDER BY id ASC');
  return rs.rows;
}
export async function getProjectConfig(id) {
  if (projectConfigCache.has(id)) return projectConfigCache.get(id);
  const rs = await executeWithRetry({ sql: 'SELECT * FROM projects_config WHERE id = ?', args: [id] });
  if (rs.rows[0]) projectConfigCache.set(id, rs.rows[0]);
  return rs.rows[0];
}
export async function upsertProjectConfig(p) {
  await executeWithRetry({ sql: 'INSERT INTO projects_config (id, github_repo, github_branch, github_token, pipeline_cron, pipeline_source_branch, pipeline_target_branch, pipeline_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET github_repo=excluded.github_repo, github_branch=excluded.github_branch, updated_at=excluded.updated_at', args: [p.id, p.github_repo, p.github_branch || 'main', p.github_token, p.pipeline_cron, p.pipeline_source_branch, p.pipeline_target_branch, p.pipeline_prompt, Date.now(), Date.now()] });
  invalidateProjectConfigCache(p.id);
}
export async function deleteProjectConfig(id) {
  await executeWithRetry({ sql: 'DELETE FROM projects_config WHERE id = ?', args: [id] });
  invalidateProjectConfigCache(id);
}

// Assignments
export async function listAssignments(pid = null) {
  const cacheKey = pid || 'all';
  if (assignmentListCache.has(cacheKey)) return assignmentListCache.get(cacheKey);

  const sql = `
    SELECT a.*, ag.name as agent_name, ag.color as agent_color 
    FROM assignments a 
    LEFT JOIN agents ag ON a.agent_id = ag.id
    ${pid ? 'WHERE a.project_id = ?' : ''}
    ORDER BY a.created_at ASC
  `;
  const q = pid ? { sql, args: [pid] } : { sql, args: [] };
  const rs = await executeWithRetry(q);
  assignmentListCache.set(cacheKey, rs.rows);
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
  const rs = await executeWithRetry({ sql: 'INSERT INTO assignments (project_id, agent_id, mode, loop_pause_ms, cron_schedule, enabled, concurrency, created_at, updated_at, custom_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [a.project_id, a.agent_id, a.mode, a.loop_pause_ms, a.cron_schedule, a.enabled !== undefined ? (a.enabled ? 1 : 0) : 1, a.concurrency || 1, Date.now(), Date.now(), a.custom_prompt] });
  invalidateAssignmentCache(a.project_id);
  return rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : null;
}
export async function updateAssignment(id, a) {
  const rs = await executeWithRetry({ sql: 'UPDATE assignments SET agent_id=?, custom_prompt=?, mode=?, loop_pause_ms=?, cron_schedule=?, enabled=?, concurrency=?, updated_at=? WHERE id=? RETURNING project_id', args: [a.agent_id, a.custom_prompt, a.mode, a.loop_pause_ms, a.cron_schedule, a.enabled ? 1 : 0, a.concurrency || 1, Date.now(), id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}
export async function deleteAssignment(id) {
  const rs = await executeWithRetry({ sql: 'DELETE FROM assignments WHERE id = ? RETURNING project_id', args: [id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}
export async function deleteAssignmentsByProject(pid) {
  await executeWithRetry({ sql: 'DELETE FROM assignments WHERE project_id = ?', args: [pid] });
  invalidateAssignmentCache(pid);
}
export async function toggleAssignment(id, enabled) {
  const rs = await executeWithRetry({ sql: 'UPDATE assignments SET enabled = ?, updated_at = ? WHERE id = ? RETURNING project_id', args: [enabled ? 1 : 0, Date.now(), id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}
export async function recordAssignmentRun(id) {
  const rs = await executeWithRetry({ sql: 'UPDATE assignments SET last_run_at = ?, total_runs = total_runs + 1 WHERE id = ? RETURNING project_id', args: [Date.now(), id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}

// Prompts
const projectPromptsCache = new Map(); // projectId -> prompts[]

export async function listPromptsByProject(pid) {
  if (projectPromptsCache.has(pid)) return projectPromptsCache.get(pid);
  const rs = await executeWithRetry({ sql: 'SELECT * FROM prompts WHERE project_id = ?', args: [pid] });
  projectPromptsCache.set(pid, rs.rows);
  return rs.rows;
}
export async function getPrompt(pid, name) {
  const prompts = await listPromptsByProject(pid);
  return prompts.find(p => p.name === name);
}
export async function upsertPrompt(pid, name, content, { source = 'manual', isInitial = false } = {}) {
  await executeWithRetry({ sql: 'INSERT INTO prompts (project_id, name, content, source, is_initial, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, name) DO UPDATE SET content=excluded.content, source=excluded.source, updated_at=excluded.updated_at', args: [pid, name, content, source, isInitial ? 1 : 0, Date.now(), Date.now()] });
  projectPromptsCache.delete(pid);
}

// Sessions
export async function recordAgentSessionStart({ assignmentId, projectId, agentName, sessionId, tokenIndex = null }) {
  const now = Date.now();
  await executeWithRetry({ 
    sql: 'INSERT INTO agent_sessions (session_id, assignment_id, project_id, agent_name, token_index, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
    args: [sessionId, assignmentId, projectId, agentName, tokenIndex, now, now] 
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

// ── Journal ───────────────────────────────────────────────────────────────────

export async function createJournalEntry({ sessionId, assignmentId, projectId, agentName, intent }) {
  await executeWithRetry({
    sql: `INSERT INTO journal (session_id, assignment_id, project_id, agent_name, intent, status, started_at)
          VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    args: [sessionId, assignmentId ?? null, projectId, agentName, intent ?? null, Date.now()],
  });
}

export async function closeJournalEntry(sessionId, { summary, status, prUrl = null, metadata = null } = {}) {
  await executeWithRetry({
    sql: `UPDATE journal
          SET summary = ?, status = ?, pr_url = ?, ended_at = ?, metadata = ?
          WHERE session_id = ?`,
    args: [
      summary ?? null,
      status ?? 'completed',
      prUrl ?? null,
      Date.now(),
      metadata ? JSON.stringify(metadata) : null,
      sessionId,
    ],
  });
}

export async function getJournalEntry(sessionId) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM journal WHERE session_id = ?', args: [sessionId] });
  const row = rs.rows[0];
  if (!row) return null;
  return { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null };
}

export async function listJournalByProject(projectId, limit = 50) {
  const rs = await executeWithRetry({
    sql: 'SELECT * FROM journal WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
    args: [projectId, limit],
  });
  return rs.rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

export async function listJournalByAssignment(assignmentId, limit = 20) {
  const rs = await executeWithRetry({
    sql: 'SELECT * FROM journal WHERE assignment_id = ? ORDER BY started_at DESC LIMIT ?',
    args: [assignmentId, limit],
  });
  return rs.rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}
