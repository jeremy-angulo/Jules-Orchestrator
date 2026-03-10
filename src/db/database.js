import Database from 'better-sqlite3';

const db = new Database('orchestrator.db', { verbose: console.log });
db.pragma('journal_mode = WAL');

// Initialize the table
db.exec(`
  CREATE TABLE IF NOT EXISTS project_states (
    project_id TEXT PRIMARY KEY,
    is_locked_for_daily BOOLEAN DEFAULT 0,
    active_tasks INTEGER DEFAULT 0
  )
`);

// Prepared statements for atomic operations
const insertProjectStmt = db.prepare('INSERT OR IGNORE INTO project_states (project_id) VALUES (?)');
const getProjectStateStmt = db.prepare('SELECT * FROM project_states WHERE project_id = ?');

const lockProjectStmt = db.prepare('UPDATE project_states SET is_locked_for_daily = 1 WHERE project_id = ?');
const unlockProjectStmt = db.prepare('UPDATE project_states SET is_locked_for_daily = 0 WHERE project_id = ?');

const incrementTasksStmt = db.prepare('UPDATE project_states SET active_tasks = active_tasks + 1 WHERE project_id = ?');
const decrementTasksStmt = db.prepare('UPDATE project_states SET active_tasks = MAX(0, active_tasks - 1) WHERE project_id = ?');

export function initProjectState(projectId) {
  insertProjectStmt.run(projectId);
}

export function lockProject(projectId) {
  lockProjectStmt.run(projectId);
}

export function unlockProject(projectId) {
  unlockProjectStmt.run(projectId);
}

export function incrementTasks(projectId) {
  incrementTasksStmt.run(projectId);
}

export function decrementTasks(projectId) {
  decrementTasksStmt.run(projectId);
}

export function isProjectLocked(projectId) {
  const row = getProjectStateStmt.get(projectId);
  return row ? !!row.is_locked_for_daily : false;
}

export function getActiveTasks(projectId) {
  const row = getProjectStateStmt.get(projectId);
  return row ? row.active_tasks : 0;
}
