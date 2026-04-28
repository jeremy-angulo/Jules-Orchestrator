import crypto from 'node:crypto';
import { 
  hasAnyDashboardUser as dbHasAnyUser,
  findUserByEmail,
  findUserById,
  createDashboardUser as dbCreateUser,
  createDashboardSession as dbCreateSession,
  findSessionWithUser,
  deleteDashboardSession as dbDeleteSession,
  deleteExpiredSessions,
  listDashboardUsers as dbListUsers,
  updateDashboardUserRole as dbUpdateRole,
  updateDashboardUserPassword as dbUpdatePassword,
  deleteDashboardUser as dbDeleteUser
} from '../db/database.js';
import { isValidRole } from './permissions.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedKey] = parts;
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(expectedKey, 'hex'), Buffer.from(derivedKey, 'hex'));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export async function hasAnyDashboardUser() {
  return await dbHasAnyUser();
}

export async function createDashboardUser(email, password, role = 'viewer') {
  const safeEmail = cleanEmail(email);
  if (!safeEmail || !safeEmail.includes('@')) throw new Error('Invalid email.');
  if (String(password || '').length < 3) throw new Error('Password must be at least 3 characters long.');
  if (!isValidRole(role)) throw new Error('Invalid role.');

  const existing = await findUserByEmail(safeEmail);
  if (existing) throw new Error('User already exists.');

  await dbCreateUser(safeEmail, hashPassword(password), role);
  return await findUserByEmail(safeEmail);
}

export async function authenticateDashboardUser(email, password) {
  const user = await findUserByEmail(cleanEmail(email));
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return user;
}

export async function createDashboardSession(userId, ttlMs = SESSION_TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + Math.max(60_000, Number(ttlMs) || SESSION_TTL_MS);
  await dbCreateSession(userId, hashToken(token), expiresAt);
  return { token, expiresAt };
}

export async function getDashboardSessionUser(token) {
  if (!token) return null;
  await deleteExpiredSessions();
  const row = await findSessionWithUser(hashToken(token));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.user_id, email: row.email, role: row.role, createdAt: row.created_at, lastLoginAt: row.last_login_at };
}

export async function deleteDashboardSession(token) {
  if (!token) return;
  await dbDeleteSession(hashToken(token));
}

export async function listDashboardUsers() {
  return await dbListUsers();
}

export async function updateDashboardUserRole(userId, role) {
  if (!isValidRole(role)) throw new Error('Invalid role.');
  await dbUpdateRole(userId, role);
  return await findUserById(userId);
}

export async function updateDashboardUserPassword(userId, password) {
  if (String(password || '').length < 3) throw new Error('Password must be at least 3 characters long.');
  await dbUpdatePassword(userId, hashPassword(password));
  return true;
}

export async function deleteDashboardUser(userId) {
  await dbDeleteUser(userId);
  return true;
}
