import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { isValidRole } from './permissions.js';

const DB_PATH = process.env.ORCHESTRATOR_DB_PATH || 'orchestrator.db';
const db = new Database(DB_PATH);

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Auth tables are small and local to the orchestrator instance.
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires_at ON dashboard_sessions (expires_at);
`);

const countUsersStmt = db.prepare('SELECT COUNT(*) as total FROM dashboard_users');
const findUserByEmailStmt = db.prepare('SELECT * FROM dashboard_users WHERE email = ?');
const findUserByIdStmt = db.prepare('SELECT id, email, role, created_at as createdAt, last_login_at as lastLoginAt FROM dashboard_users WHERE id = ?');
const insertUserStmt = db.prepare('INSERT INTO dashboard_users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
const updateLoginStmt = db.prepare('UPDATE dashboard_users SET last_login_at = ? WHERE id = ?');
const updateUserRoleStmt = db.prepare('UPDATE dashboard_users SET role = ? WHERE id = ?');
const updatePasswordStmt = db.prepare('UPDATE dashboard_users SET password_hash = ? WHERE id = ?');
const deleteUserStmt = db.prepare('DELETE FROM dashboard_users WHERE id = ?');

const insertSessionStmt = db.prepare('INSERT INTO dashboard_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)');
const deleteSessionStmt = db.prepare('DELETE FROM dashboard_sessions WHERE token_hash = ?');
const deleteExpiredSessionsStmt = db.prepare('DELETE FROM dashboard_sessions WHERE expires_at < ?');
const findSessionWithUserStmt = db.prepare(`
  SELECT
    s.user_id as userId,
    s.expires_at as expiresAt,
    u.email as email,
    u.role as role,
    u.created_at as createdAt,
    u.last_login_at as lastLoginAt
  FROM dashboard_sessions s
  JOIN dashboard_users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedKey] = parts;
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const expectedBuffer = Buffer.from(expectedKey, 'hex');
  const derivedBuffer = Buffer.from(derivedKey, 'hex');
  if (expectedBuffer.length !== derivedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, derivedBuffer);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function hasAnyDashboardUser() {
  const row = countUsersStmt.get();
  return (row?.total || 0) > 0;
}

export function createDashboardUser(email, password, role = 'viewer') {
  const safeEmail = cleanEmail(email);
  const safePassword = String(password || '');
  if (!safeEmail || !safeEmail.includes('@')) {
    throw new Error('Invalid email.');
  }
  if (safePassword.length < 3) {
    throw new Error('Password must be at least 3 characters long.');
  }
  if (!isValidRole(role)) {
    throw new Error('Invalid role.');
  }

  const existing = findUserByEmailStmt.get(safeEmail);
  if (existing) {
    throw new Error('User already exists.');
  }

  const passwordHash = hashPassword(safePassword);
  const createdAt = Date.now();
  const info = insertUserStmt.run(safeEmail, passwordHash, role, createdAt);
  const user = findUserByIdStmt.get(info.lastInsertRowid);
  return user;
}

export function authenticateDashboardUser(email, password) {
  const safeEmail = cleanEmail(email);
  const user = findUserByEmailStmt.get(safeEmail);
  if (!user) {
    return null;
  }
  if (!verifyPassword(password, user.password_hash)) {
    return null;
  }
  const now = Date.now();
  updateLoginStmt.run(now, user.id);
  return findUserByIdStmt.get(user.id);
}

export function createDashboardSession(userId, ttlMs = SESSION_TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = now + Math.max(60_000, Number(ttlMs) || SESSION_TTL_MS);
  insertSessionStmt.run(userId, tokenHash, expiresAt, now);
  return {
    token,
    expiresAt
  };
}

export function getDashboardSessionUser(token) {
  if (!token) {
    return null;
  }
  deleteExpiredSessionsStmt.run(Date.now());
  const tokenHash = hashToken(token);
  const row = findSessionWithUserStmt.get(tokenHash);
  if (!row) {
    return null;
  }
  if (row.expiresAt < Date.now()) {
    deleteSessionStmt.run(tokenHash);
    return null;
  }
  return {
    id: row.userId,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt
  };
}

export function deleteDashboardSession(token) {
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token);
  deleteSessionStmt.run(tokenHash);
}

export function listDashboardUsers() {
  return db
    .prepare('SELECT id, email, role, created_at as createdAt, last_login_at as lastLoginAt FROM dashboard_users ORDER BY id ASC')
    .all();
}

export function updateDashboardUserRole(userId, role) {
  if (!isValidRole(role)) {
    throw new Error('Invalid role.');
  }
  const info = updateUserRoleStmt.run(role, userId);
  if (info.changes === 0) {
    throw new Error('User not found.');
  }
  return findUserByIdStmt.get(userId);
}

export function updateDashboardUserPassword(userId, password) {
  const safePassword = String(password || '');
  if (safePassword.length < 3) {
    throw new Error('Password must be at least 3 characters long.');
  }
  const passwordHash = hashPassword(safePassword);
  const info = updatePasswordStmt.run(passwordHash, userId);
  if (info.changes === 0) {
    throw new Error('User not found.');
  }
  return true;
}

export function deleteDashboardUser(userId) {
  const info = deleteUserStmt.run(userId);
  if (info.changes === 0) {
    throw new Error('User not found.');
  }
  return true;
}
