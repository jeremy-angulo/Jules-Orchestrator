import { executeWithRetry } from './core.js';

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
