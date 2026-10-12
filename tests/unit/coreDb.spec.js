import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('core.js DB', () => {
    let coreDb;
    let mockClient;

    beforeEach(async () => {
        mockClient = {
            execute: vi.fn(),
            batch: vi.fn()
        };

        coreDb = await esmock('../../src/db/core.js', {
            '@libsql/client': {
                createClient: () => mockClient
            }
        });
    });

    it('should be initialized', () => {
        expect(coreDb).toBeDefined();
        expect(coreDb.client).toBe(mockClient);
    });

    describe('environment and client creation branches', () => {
        it('should initialize createClient with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in non-test mode', async () => {
            let capturedOptions = null;
            const originalNodeEnv = process.env.NODE_ENV;
            const originalUrl = process.env.TURSO_DATABASE_URL;
            const originalToken = process.env.TURSO_AUTH_TOKEN;

            try {
                process.env.NODE_ENV = 'production';
                process.env.TURSO_DATABASE_URL = 'libsql://my-turso-db.turso.io';
                process.env.TURSO_AUTH_TOKEN = 'secret-turso-token';

                await esmock('../../src/db/core.js', {
                    '@libsql/client': {
                        createClient: (opts) => {
                            capturedOptions = opts;
                            return mockClient;
                        }
                    }
                });

                expect(capturedOptions).toEqual({
                    url: 'libsql://my-turso-db.turso.io',
                    authToken: 'secret-turso-token'
                });
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
                if (originalUrl !== undefined) process.env.TURSO_DATABASE_URL = originalUrl;
                else delete process.env.TURSO_DATABASE_URL;
                if (originalToken !== undefined) process.env.TURSO_AUTH_TOKEN = originalToken;
                else delete process.env.TURSO_AUTH_TOKEN;
            }
        });
    });

    describe('pruneOldData', () => {
        it('should delete old data from audit_log and agent_sessions', async () => {
            const now = 1700000000000;
            vi.spyOn(Date, 'now').mockReturnValue(now);
            const daysToKeep = 7;
            const cutoff = now - daysToKeep * 24 * 60 * 60 * 1000;

            mockClient.execute.mockResolvedValue({ rowsAffected: 5 });

            const results = await coreDb.pruneOldData(daysToKeep);

            expect(results).toEqual({
                audit_log: 5,
                agent_sessions: 5
            });

            expect(mockClient.execute).toHaveBeenCalledWith(expect.objectContaining({
                sql: expect.stringContaining('DELETE FROM audit_log WHERE timestamp < ?'),
                args: [cutoff]
            }));
            expect(mockClient.execute).toHaveBeenCalledWith(expect.objectContaining({
                sql: expect.stringContaining('DELETE FROM agent_sessions WHERE started_at < ?'),
                args: [cutoff]
            }));
        });

        it('should handle errors for specific tables', async () => {
            mockClient.execute
                .mockResolvedValueOnce({ rowsAffected: 10 })
                .mockRejectedValueOnce(new Error('DB error'));

            const results = await coreDb.pruneOldData();

            expect(results).toEqual({
                audit_log: 10,
                agent_sessions: 'error: DB error'
            });
        });
    });

    describe('executeWithRetry', () => {
        it('should execute successfully on first try', async () => {
            mockClient.execute.mockResolvedValue({ rows: [1, 2, 3] });
            const result = await coreDb.executeWithRetry('SELECT 1');
            expect(result).toEqual({ rows: [1, 2, 3] });
            expect(mockClient.execute).toHaveBeenCalledTimes(1);
        });

        it('should normalize statement object and replace undefined args with null', async () => {
            mockClient.execute.mockResolvedValue({ rows: [] });
            await coreDb.executeWithRetry({
                sql: 'INSERT INTO users (name, age, role) VALUES (?, ?, ?)',
                args: ['Alice', undefined, undefined]
            });

            expect(mockClient.execute).toHaveBeenCalledWith({
                sql: 'INSERT INTO users (name, age, role) VALUES (?, ?, ?)',
                args: ['Alice', null, null]
            });
        });

        it('should normalize statement object with empty/undefined args array', async () => {
            mockClient.execute.mockResolvedValue({ rows: [] });
            await coreDb.executeWithRetry({
                sql: 'SELECT * FROM users'
            });

            expect(mockClient.execute).toHaveBeenCalledWith({
                sql: 'SELECT * FROM users',
                args: []
            });
        });

        it('should retry on SQLITE_BUSY and eventually succeed', async () => {
            const busyError = new Error('Database busy');
            busyError.code = 'SQLITE_BUSY';

            mockClient.execute
                .mockRejectedValueOnce(busyError)
                .mockRejectedValueOnce(busyError)
                .mockResolvedValue({ success: true });

            const result = await coreDb.executeWithRetry('SELECT 1', 5, 10);
            expect(result).toEqual({ success: true });
            expect(mockClient.execute).toHaveBeenCalledTimes(3);
        });

        it('should fail after max retries', async () => {
            const busyError = new Error('Database busy');
            busyError.code = 'SQLITE_BUSY';

            mockClient.execute.mockRejectedValue(busyError);

            await expect(coreDb.executeWithRetry('SELECT 1', 3, 10))
                .rejects.toThrow('Database busy');
            expect(mockClient.execute).toHaveBeenCalledTimes(3);
        });
    });

    describe('batchWithRetry', () => {
        it('should batch execute successfully', async () => {
            mockClient.batch.mockResolvedValue([{ rowsAffected: 1 }]);
            const result = await coreDb.batchWithRetry(['INSERT INTO x VALUES (1)'], 'write');
            expect(result).toEqual([{ rowsAffected: 1 }]);
            expect(mockClient.batch).toHaveBeenCalledWith(expect.any(Array), 'write');
        });

        it('should normalize object statements and convert undefined args to null in batch', async () => {
            mockClient.batch.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 1 }]);
            await coreDb.batchWithRetry([
                'INSERT INTO x VALUES (1)',
                { sql: 'INSERT INTO y (a, b) VALUES (?, ?)', args: ['val', undefined] },
                { sql: 'DELETE FROM z' }
            ], 'write');

            expect(mockClient.batch).toHaveBeenCalledWith([
                'INSERT INTO x VALUES (1)',
                { sql: 'INSERT INTO y (a, b) VALUES (?, ?)', args: ['val', null] },
                { sql: 'DELETE FROM z', args: [] }
            ], 'write');
        });

        it('should retry batch on SQLITE_BUSY', async () => {
            const busyError = new Error('Database busy');
            busyError.code = 'SQLITE_BUSY';

            mockClient.batch
                .mockRejectedValueOnce(busyError)
                .mockResolvedValue([{ success: true }]);

            const result = await coreDb.batchWithRetry(['INSERT INTO x'], 'write', 3, 10);
            expect(result).toEqual([{ success: true }]);
            expect(mockClient.batch).toHaveBeenCalledTimes(2);
        });
    });
});
