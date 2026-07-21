import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('users.js DB', () => {
    let usersDb;
    let mockExecute;

    beforeEach(async () => {
        mockExecute = vi.fn();
        usersDb = await esmock('../../src/db/users.js', {
            '../../src/db/core.js': { executeWithRetry: mockExecute }
        });
    });

    it('hasAnyDashboardUser should return true if count > 0', async () => {
        mockExecute.mockResolvedValue({ rows: [{ c: 1 }] });
        const result = await usersDb.hasAnyDashboardUser();
        expect(result).toBe(true);
        expect(mockExecute).toHaveBeenCalledWith('SELECT COUNT(*) as c FROM dashboard_users');
    });

    it('findUserByEmail should return user row', async () => {
        const mockUser = { id: 1, email: 'test@ex.com' };
        mockExecute.mockResolvedValue({ rows: [mockUser] });
        const user = await usersDb.findUserByEmail('test@ex.com');
        expect(user).toEqual(mockUser);
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            args: ['test@ex.com']
        }));
    });

    it('createDashboardUser should insert user with timestamp', async () => {
        await usersDb.createDashboardUser('new@ex.com', 'hash', 'admin');
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('INSERT INTO dashboard_users'),
            args: expect.arrayContaining(['new@ex.com', 'hash', 'admin', expect.any(Number)])
        }));
    });

    it('findSessionWithUser should join tables', async () => {
        const mockSession = { id: 10, email: 'u@ex.com' };
        mockExecute.mockResolvedValue({ rows: [mockSession] });
        const session = await usersDb.findSessionWithUser('session-hash');
        expect(session).toEqual(mockSession);
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('JOIN dashboard_users'),
            args: ['session-hash']
        }));
    });

    it('deleteExpiredSessions should use current timestamp', async () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        await usersDb.deleteExpiredSessions();
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('DELETE FROM dashboard_sessions WHERE expires_at < ?'),
            args: [now]
        }));
    });

    it('updateDashboardUserRole should update role', async () => {
        await usersDb.updateDashboardUserRole(1, 'editor');
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('UPDATE dashboard_users SET role = ? WHERE id = ?'),
            args: ['editor', 1]
        }));
    });

    it('findUserById should return user row', async () => {
        const mockUser = { id: 42, email: 'user42@ex.com', role: 'user' };
        mockExecute.mockResolvedValue({ rows: [mockUser] });
        const user = await usersDb.findUserById(42);
        expect(user).toEqual(mockUser);
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('SELECT id, email, role, created_at, last_login_at FROM dashboard_users WHERE id = ?'),
            args: [42]
        }));
    });

    it('createDashboardSession should insert session with current timestamp', async () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        await usersDb.createDashboardSession(123, 'session-hash-123', 999999);
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('INSERT INTO dashboard_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'),
            args: [123, 'session-hash-123', 999999, now]
        }));
    });

    it('deleteDashboardSession should delete session by hash', async () => {
        await usersDb.deleteDashboardSession('some-hash');
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('DELETE FROM dashboard_sessions WHERE token_hash = ?'),
            args: ['some-hash']
        }));
    });

    it('listDashboardUsers should select and return users ordered by id', async () => {
        const mockUsers = [{ id: 1, email: 'a@ex.com' }, { id: 2, email: 'b@ex.com' }];
        mockExecute.mockResolvedValue({ rows: mockUsers });
        const users = await usersDb.listDashboardUsers();
        expect(users).toEqual(mockUsers);
        expect(mockExecute).toHaveBeenCalledWith('SELECT id, email, role, created_at, last_login_at FROM dashboard_users ORDER BY id ASC');
    });

    it('updateDashboardUserPassword should update password hash', async () => {
        await usersDb.updateDashboardUserPassword(99, 'new-password-hash');
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('UPDATE dashboard_users SET password_hash = ? WHERE id = ?'),
            args: ['new-password-hash', 99]
        }));
    });

    it('deleteDashboardUser should delete user by id', async () => {
        await usersDb.deleteDashboardUser(88);
        expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
            sql: expect.stringContaining('DELETE FROM dashboard_users WHERE id = ?'),
            args: [88]
        }));
    });
});
