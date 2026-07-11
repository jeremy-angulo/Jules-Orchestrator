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
