import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('isProjectLocked - uses cache if available', async () => {
    const executeSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: new Map([['p1', { is_locked_for_daily: 1 }]]),
            invalidateProjectStateCache: () => {}
        }
    });

    const result = await projects.isProjectLocked('p1');
    expect(result).toBe(true);
    expect(executeSpy).not.toHaveBeenCalled();
});

test('lockProject - updates DB and invalidates cache', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const invalidateSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: new Map(),
            invalidateProjectStateCache: invalidateSpy
        }
    });

    await projects.lockProject('p1', 'reasonX');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('is_locked_for_daily = 1'),
        args: expect.arrayContaining(['reasonX', 'p1'])
    }));
    expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('getActiveTasks - returns number of active tasks', async () => {
    const executeSpy = vi.fn(async () => ({ rows: [{ active_tasks: 5 }] }));
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: new Map(),
            invalidateProjectStateCache: () => {}
        }
    });

    const tasks = await projects.getActiveTasks('p2');
    expect(tasks).toBe(5);
    expect(executeSpy).toHaveBeenCalled();
});

test('upsertProjectConfig - inserts or updates project config', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectConfigCache: new Map(),
            invalidateProjectConfigCache: vi.fn()
        }
    });

    await projects.upsertProjectConfig({ id: 'new-p', github_repo: 'o/r' });
    expect(executeSpy).toHaveBeenCalled();
    const call = executeSpy.mock.calls[0][0];
    expect(call.sql).toContain('INSERT INTO projects_config');
    expect(call.args).toContain('new-p');
    expect(call.args).toContain('o/r');
});
