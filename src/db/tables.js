import { client, batchWithRetry } from './core.js';

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
      build_pipeline_enabled BOOLEAN NOT NULL DEFAULT 0,
      conflict_resolver_enabled BOOLEAN NOT NULL DEFAULT 0,
      conflict_resolver_cron TEXT DEFAULT '0 18 * * *',
      site_check_enabled BOOLEAN NOT NULL DEFAULT 0,
      site_check_base_url TEXT,
      site_check_pause_ms INTEGER NOT NULL DEFAULT 5000,
      site_check_locale TEXT NOT NULL DEFAULT 'fr',
      site_check_concurrency INTEGER NOT NULL DEFAULT 1,
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
    )`,
    `CREATE TABLE IF NOT EXISTS site_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      url TEXT NOT NULL,
      group_name TEXT,
      priority INTEGER DEFAULT 0,
      last_screenshot_at TEXT,
      last_analysis_at TEXT,
      locked_by TEXT,
      locked_at TEXT,
      status TEXT NOT NULL DEFAULT 'ANALYZE',
      screenshot_path TEXT,
      issues JSON,
      requires_auth BOOLEAN DEFAULT 0,
      requires_admin BOOLEAN DEFAULT 0,
      is_wizard BOOLEAN DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects_config(id) ON DELETE CASCADE
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
    "ALTER TABLE projects_config ADD COLUMN site_check_enabled BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE projects_config ADD COLUMN site_check_base_url TEXT",
    "ALTER TABLE projects_config ADD COLUMN site_check_pause_ms INTEGER NOT NULL DEFAULT 5000",
    "ALTER TABLE projects_config ADD COLUMN site_check_locale TEXT NOT NULL DEFAULT 'fr'",
    "ALTER TABLE projects_config ADD COLUMN site_check_concurrency INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE site_pages ADD COLUMN screenshot_path TEXT",
    "ALTER TABLE site_pages ADD COLUMN issues JSON",
    "ALTER TABLE site_pages ADD COLUMN requires_auth BOOLEAN DEFAULT 0",
    "ALTER TABLE site_pages ADD COLUMN requires_admin BOOLEAN DEFAULT 0",
    "ALTER TABLE site_pages ADD COLUMN is_wizard BOOLEAN DEFAULT 0",
    "ALTER TABLE projects_config ADD COLUMN build_pipeline_enabled BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE projects_config ADD COLUMN conflict_resolver_enabled BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE projects_config ADD COLUMN conflict_resolver_cron TEXT DEFAULT '0 18 * * *'",
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
