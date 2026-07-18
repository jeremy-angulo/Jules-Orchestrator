import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('initTables - initializes tables and executes migrations', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ success: true });
    const batchSpy = vi.fn().mockResolvedValue([{ success: true }]);

    const tables = await esmock('../../src/db/tables.js', {
        '../../src/db/core.js': {
            client: {
                execute: executeSpy
            },
            batchWithRetry: batchSpy
        }
    });

    await tables.initTables();

    // Verify that batchWithRetry was called with table creation SQL statements
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const sqlQueries = batchSpy.mock.calls[0][0];
    expect(sqlQueries).toBeInstanceOf(Array);
    expect(sqlQueries.length).toBeGreaterThan(5);
    expect(sqlQueries[0]).toContain('CREATE TABLE IF NOT EXISTS project_states');

    // Verify that client.execute was called for migrations
    expect(executeSpy).toHaveBeenCalled();
    const executeCalls = executeSpy.mock.calls.map(call => call[0]);
    expect(executeCalls).toContain('ALTER TABLE agent_sessions ADD COLUMN started_at INTEGER');
});

test('initTables - handles migration errors gracefully', async () => {
    const executeSpy = vi.fn()
        .mockRejectedValueOnce(new Error('duplicate column name: started_at'))
        .mockResolvedValue({ success: true });
    const batchSpy = vi.fn().mockResolvedValue([{ success: true }]);

    const tables = await esmock('../../src/db/tables.js', {
        '../../src/db/core.js': {
            client: {
                execute: executeSpy
            },
            batchWithRetry: batchSpy
        }
    });

    // Should not throw even if a migration fails
    await expect(tables.initTables()).resolves.not.toThrow();

    expect(batchSpy).toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalled();
});
