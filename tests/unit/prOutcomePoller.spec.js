import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('prOutcomePoller - runPROutcomeCycle updates status to merged', async () => {
    const sqlCalls = [];
    const mockRows = [
        { id: 1, project_id: 'p1', pr_url: 'https://github.com/owner/repo/pull/123', pr_status: 'open', ended_at: Date.now() }
    ];

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                sqlCalls.push(stmt);
                if (stmt.sql.includes('SELECT')) return { rows: mockRows };
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ merged: true, state: 'closed' })
    })));

    const projectById = new Map();
    projectById.set('p1', { githubRepo: 'owner/repo', githubToken: 'token-p1' });

    await prOutcomePoller.runPROutcomeCycle(projectById);

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    expect(updateCall).toBeDefined();
    expect(updateCall.args).toEqual(['merged', 1]);
    expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/pulls/123',
        expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer token-p1'
            })
        })
    );
});

test('prOutcomePoller - runPROutcomeCycle updates status to closed', async () => {
    const sqlCalls = [];
    const mockRows = [
        { id: 2, project_id: 'p2', pr_url: 'https://github.com/owner/repo2/pull/456', pr_status: 'open', ended_at: Date.now() }
    ];

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                sqlCalls.push(stmt);
                if (stmt.sql.includes('SELECT')) return { rows: mockRows };
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ merged: false, state: 'closed' })
    })));

    const projectById = new Map();

    await prOutcomePoller.runPROutcomeCycle(projectById);

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    expect(updateCall).toBeDefined();
    expect(updateCall.args).toEqual(['closed', 2]);
});

test('prOutcomePoller - runPROutcomeCycle does not update if still open', async () => {
    const sqlCalls = [];
    const mockRows = [
        { id: 3, project_id: 'p3', pr_url: 'https://github.com/owner/repo3/pull/789', pr_status: 'open', ended_at: Date.now() }
    ];

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                sqlCalls.push(stmt);
                if (stmt.sql.includes('SELECT')) return { rows: mockRows };
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ merged: false, state: 'open' })
    })));

    const projectById = new Map();
    await prOutcomePoller.runPROutcomeCycle(projectById);

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    expect(updateCall).toBeUndefined();
});

test('prOutcomePoller - runPROutcomeCycle handles fetch error', async () => {
    const sqlCalls = [];
    const mockRows = [
        { id: 4, project_id: 'p4', pr_url: 'https://github.com/owner/repo4/pull/101', pr_status: 'open', ended_at: Date.now() }
    ];

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                sqlCalls.push(stmt);
                if (stmt.sql.includes('SELECT')) return { rows: mockRows };
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false
    })));

    const projectById = new Map();
    await prOutcomePoller.runPROutcomeCycle(projectById);

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    expect(updateCall).toBeUndefined();
});

test('prOutcomePoller - runPROutcomeCycle handles network error', async () => {
    const sqlCalls = [];
    const mockRows = [
        { id: 5, project_id: 'p5', pr_url: 'https://github.com/owner/repo5/pull/202', pr_status: 'open', ended_at: Date.now() }
    ];

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                sqlCalls.push(stmt);
                if (stmt.sql.includes('SELECT')) return { rows: mockRows };
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('Network failure');
    }));

    const projectById = new Map();
    await prOutcomePoller.runPROutcomeCycle(projectById);

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    expect(updateCall).toBeUndefined();
});

test('prOutcomePoller - runPROutcomeCycle uses master token fallback', async () => {
    const sqlCalls = [];
    const mockRows = [
        { id: 6, project_id: 'p6', pr_url: 'https://github.com/owner/repo6/pull/303', pr_status: 'open', ended_at: Date.now() }
    ];

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                sqlCalls.push(stmt);
                if (stmt.sql.includes('SELECT')) return { rows: mockRows };
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ merged: true, state: 'closed' })
    })));

    const projectById = new Map();
    projectById.set('Jules-Orchestrator', { githubToken: 'master-token' });

    await prOutcomePoller.runPROutcomeCycle(projectById);

    expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer master-token'
            })
        })
    );
});

test('prOutcomePoller - startPROutcomePoller schedules cycles and handles errors', async () => {
    vi.useFakeTimers();

    let cycleCallCount = 0;
    const logSpy = vi.fn();

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn().mockImplementation(async () => {
                cycleCallCount++;
                if (cycleCallCount === 1) {
                    throw new Error('Immediate error');
                }
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: logSpy
        }
    });

    const projectById = new Map();
    const intervalHandle = prOutcomePoller.startPROutcomePoller(projectById);

    // Settle the immediate run without firing the 15m interval
    await vi.advanceTimersByTimeAsync(10);

    // Verify immediate call error was logged
    expect(cycleCallCount).toBe(1);
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('Initial cycle failed: Immediate error'));

    clearInterval(intervalHandle);
    vi.useRealTimers();
});

test('prOutcomePoller - startPROutcomePoller triggers successfully on interval', async () => {
    vi.useFakeTimers();

    let selectQueryCount = 0;
    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async (stmt) => {
                if (stmt.sql && stmt.sql.includes('SELECT')) {
                    selectQueryCount++;
                }
                return { rows: [] };
            })
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    const projectById = new Map();
    const intervalHandle = prOutcomePoller.startPROutcomePoller(projectById);

    // Settle the initial immediate call (runs without advancing interval)
    await vi.advanceTimersByTimeAsync(10);
    expect(selectQueryCount).toBe(1);

    // Advance by 15 minutes (POLL_INTERVAL_MS = 15 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(selectQueryCount).toBe(2);

    // Advance by another 15 minutes
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(selectQueryCount).toBe(3);

    clearInterval(intervalHandle);
    vi.useRealTimers();
});

test('prOutcomePoller - startPROutcomePoller logs interval cycle failure', async () => {
    vi.useFakeTimers();

    const logSpy = vi.fn();
    let isInitial = true;

    const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
        '../../src/db/core.js': {
            executeWithRetry: vi.fn(async () => {
                if (isInitial) {
                    isInitial = false;
                    return { rows: [] }; // Initial call succeeds
                }
                throw new Error('Interval call failure'); // Interval call fails
            })
        },
        '../../src/utils/logger.js': {
            log: logSpy
        }
    });

    const projectById = new Map();
    const intervalHandle = prOutcomePoller.startPROutcomePoller(projectById);

    // Settle initial immediate call
    await vi.advanceTimersByTimeAsync(10);
    expect(logSpy).not.toHaveBeenCalled();

    // Advance by 15 minutes to trigger the interval call which should fail
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    // Verify interval cycle error was logged
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('Cycle failed: Interval call failure'));

    clearInterval(intervalHandle);
    vi.useRealTimers();
});
