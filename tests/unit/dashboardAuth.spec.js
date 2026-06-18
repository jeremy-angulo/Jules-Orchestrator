import { describe, it, expect, vi } from 'vitest';
import { getDashboardSessionUser, authenticateDashboardUser } from '../../src/auth/dashboardAuth.js';
import * as db from '../../src/db/database.js';
import crypto from 'node:crypto';

vi.mock('../../src/db/database.js', () => ({
  deleteExpiredSessions: vi.fn(),
  findSessionWithUser: vi.fn(),
  findUserByEmail: vi.fn()
}));

describe('dashboardAuth', () => {
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
        expires_at: Date.now() + 10000
      };
      vi.mocked(db.findSessionWithUser).mockResolvedValue(mockUser);

      const user = await getDashboardSessionUser('valid-token');
      expect(user).toEqual({
        id: mockUser.user_id,
        email: mockUser.email,
        role: mockUser.role,
        createdAt: undefined,
        lastLoginAt: undefined
      });
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
});
