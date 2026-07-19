import { describe, it, expect, vi } from 'vitest';
import {
  hasAnyDashboardUser,
  createDashboardUser,
  authenticateDashboardUser,
  createDashboardSession,
  getDashboardSessionUser,
  deleteDashboardSession,
  listDashboardUsers,
  updateDashboardUserRole,
  updateDashboardUserPassword,
  deleteDashboardUser
} from '../../src/auth/dashboardAuth.js';
import * as db from '../../src/db/database.js';
import crypto from 'node:crypto';

vi.mock('../../src/db/database.js', () => ({
  hasAnyDashboardUser: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  createDashboardUser: vi.fn(),
  createDashboardSession: vi.fn(),
  findSessionWithUser: vi.fn(),
  deleteDashboardSession: vi.fn(),
  deleteExpiredSessions: vi.fn(),
  listDashboardUsers: vi.fn(),
  updateDashboardUserRole: vi.fn(),
  updateDashboardUserPassword: vi.fn(),
  deleteDashboardUser: vi.fn()
}));

describe('dashboardAuth', () => {

  describe('hasAnyDashboardUser', () => {
    it('should return true if users exist', async () => {
      vi.mocked(db.hasAnyDashboardUser).mockResolvedValue(true);
      const res = await hasAnyDashboardUser();
      expect(res).toBe(true);
      expect(db.hasAnyDashboardUser).toHaveBeenCalled();
    });

    it('should return false if no users exist', async () => {
      vi.mocked(db.hasAnyDashboardUser).mockResolvedValue(false);
      const res = await hasAnyDashboardUser();
      expect(res).toBe(false);
    });
  });

  describe('createDashboardUser', () => {
    it('should create a dashboard user successfully', async () => {
      const mockUser = { id: 1, email: 'new@example.com', role: 'viewer' };
      vi.mocked(db.findUserByEmail).mockResolvedValueOnce(null).mockResolvedValueOnce(mockUser);
      vi.mocked(db.createDashboardUser).mockResolvedValue(true);

      const user = await createDashboardUser('new@example.com', 'password123', 'viewer');
      expect(user).toEqual(mockUser);
      expect(db.createDashboardUser).toHaveBeenCalledWith(
        'new@example.com',
        expect.stringContaining('scrypt$'),
        'viewer'
      );
    });

    it('should throw an error for invalid email format', async () => {
      await expect(createDashboardUser('invalid-email', 'password123', 'viewer'))
        .rejects.toThrow('Invalid email.');
      await expect(createDashboardUser(null, 'password123', 'viewer'))
        .rejects.toThrow('Invalid email.');
    });

    it('should throw an error for a password shorter than 3 characters', async () => {
      await expect(createDashboardUser('valid@example.com', '12', 'viewer'))
        .rejects.toThrow('Password must be at least 3 characters long.');
      await expect(createDashboardUser('valid@example.com', null, 'viewer'))
        .rejects.toThrow('Password must be at least 3 characters long.');
    });

    it('should throw an error for an invalid role', async () => {
      await expect(createDashboardUser('valid@example.com', 'password123', 'invalid-role'))
        .rejects.toThrow('Invalid role.');
    });

    it('should throw an error if the user already exists', async () => {
      vi.mocked(db.findUserByEmail).mockResolvedValue({ id: 1, email: 'exists@example.com' });
      await expect(createDashboardUser('exists@example.com', 'password123', 'viewer'))
        .rejects.toThrow('User already exists.');
    });
  });

  describe('authenticateDashboardUser', () => {
    it('should return null if user not found', async () => {
      vi.mocked(db.findUserByEmail).mockResolvedValue(null);
      const user = await authenticateDashboardUser('missing@example.com', 'password');
      expect(user).toBeNull();
    });

    it('should return null if password incorrect', async () => {
      const salt = crypto.randomBytes(16).toString('hex');
      const key = crypto.scryptSync('correct-password', salt, 64).toString('hex');
      const hash = `scrypt$${salt}$${key}`;

      vi.mocked(db.findUserByEmail).mockResolvedValue({
        email: 'test@example.com',
        password_hash: hash
      });

      const user = await authenticateDashboardUser('test@example.com', 'wrong-password');
      expect(user).toBeNull();
    });

    it('should return user if password correct', async () => {
      const salt = crypto.randomBytes(16).toString('hex');
      const key = crypto.scryptSync('correct-password', salt, 64).toString('hex');
      const hash = `scrypt$${salt}$${key}`;
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        password_hash: hash
      };

      vi.mocked(db.findUserByEmail).mockResolvedValue(mockUser);

      const user = await authenticateDashboardUser('test@example.com', 'correct-password');
      expect(user).toEqual(mockUser);
    });
  });

  describe('createDashboardSession', () => {
    it('should generate token and expires_at and store hashed token in database', async () => {
      vi.mocked(db.createDashboardSession).mockResolvedValue(true);
      const { token, expiresAt } = await createDashboardSession(123, 100000);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(expiresAt).toBeGreaterThan(Date.now());
      expect(db.createDashboardSession).toHaveBeenCalledWith(
        123,
        expect.any(String),
        expiresAt
      );
    });
  });

  describe('getDashboardSessionUser', () => {
    it('should return null if no token provided', async () => {
      const user = await getDashboardSessionUser(null);
      expect(user).toBeNull();
    });

    it('should return null if session not found', async () => {
      vi.mocked(db.findSessionWithUser).mockResolvedValue(null);
      const user = await getDashboardSessionUser('invalid-token');
      expect(user).toBeNull();
    });

    it('should return null if session expired', async () => {
      vi.mocked(db.findSessionWithUser).mockResolvedValue({
        expires_at: Date.now() - 1000
      });
      const user = await getDashboardSessionUser('expired-token');
      expect(user).toBeNull();
    });

    it('should return user info if session valid', async () => {
      const mockUser = {
        user_id: 1,
        email: 'test@example.com',
        role: 'admin',
        expires_at: Date.now() + 10000,
        created_at: 12345,
        last_login_at: 67890
      };
      vi.mocked(db.findSessionWithUser).mockResolvedValue(mockUser);

      const user = await getDashboardSessionUser('valid-token');
      expect(user).toEqual({
        id: mockUser.user_id,
        email: mockUser.email,
        role: mockUser.role,
        createdAt: 12345,
        lastLoginAt: 67890
      });
    });
  });

  describe('deleteDashboardSession', () => {
    it('should return early if no token', async () => {
      await deleteDashboardSession(null);
      expect(db.deleteDashboardSession).not.toHaveBeenCalled();
    });

    it('should call db.deleteDashboardSession with hashed token', async () => {
      vi.mocked(db.deleteDashboardSession).mockResolvedValue(true);
      await deleteDashboardSession('token-to-delete');
      expect(db.deleteDashboardSession).toHaveBeenCalledWith(
        crypto.createHash('sha256').update('token-to-delete').digest('hex')
      );
    });
  });

  describe('listDashboardUsers', () => {
    it('should list all dashboard users', async () => {
      const mockUsers = [
        { id: 1, email: 'u1@example.com' },
        { id: 2, email: 'u2@example.com' }
      ];
      vi.mocked(db.listDashboardUsers).mockResolvedValue(mockUsers);

      const users = await listDashboardUsers();
      expect(users).toEqual(mockUsers);
    });
  });

  describe('updateDashboardUserRole', () => {
    it('should update role and return updated user', async () => {
      const mockUser = { id: 123, email: 'u@example.com', role: 'admin' };
      vi.mocked(db.updateDashboardUserRole).mockResolvedValue(true);
      vi.mocked(db.findUserById).mockResolvedValue(mockUser);

      const user = await updateDashboardUserRole(123, 'admin');
      expect(user).toEqual(mockUser);
      expect(db.updateDashboardUserRole).toHaveBeenCalledWith(123, 'admin');
    });

    it('should throw an error for an invalid role', async () => {
      await expect(updateDashboardUserRole(123, 'hacker'))
        .rejects.toThrow('Invalid role.');
    });
  });

  describe('updateDashboardUserPassword', () => {
    it('should update password and return true', async () => {
      vi.mocked(db.updateDashboardUserPassword).mockResolvedValue(true);

      const res = await updateDashboardUserPassword(123, 'new-password');
      expect(res).toBe(true);
      expect(db.updateDashboardUserPassword).toHaveBeenCalledWith(
        123,
        expect.stringContaining('scrypt$')
      );
    });

    it('should throw an error for short password', async () => {
      await expect(updateDashboardUserPassword(123, '12'))
        .rejects.toThrow('Password must be at least 3 characters long.');
    });
  });

  describe('deleteDashboardUser', () => {
    it('should delete user and return true', async () => {
      vi.mocked(db.deleteDashboardUser).mockResolvedValue(true);

      const res = await deleteDashboardUser(123);
      expect(res).toBe(true);
      expect(db.deleteDashboardUser).toHaveBeenCalledWith(123);
    });
  });

});