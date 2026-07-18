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

test('initProjectState - inserts project state', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const invalidateSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: new Map(),
            invalidateProjectStateCache: invalidateSpy
        }
    });

    await projects.initProjectState('p1');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('INSERT OR IGNORE INTO project_states'),
        args: ['p1']
    }));
    expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('unlockProject - updates DB and invalidates cache', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const invalidateSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: new Map(),
            invalidateProjectStateCache: invalidateSpy
        }
    });

    await projects.unlockProject('p1');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('is_locked_for_daily = 0'),
        args: ['p1']
    }));
    expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('incrementTasks, decrementTasks, setActiveTasks - update DB and cache', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const invalidateSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: new Map(),
            invalidateProjectStateCache: invalidateSpy
        }
    });

    await projects.incrementTasks('p1');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('active_tasks = active_tasks + 1'),
        args: ['p1']
    }));

    await projects.decrementTasks('p1');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('active_tasks = MAX(0, active_tasks - 1)'),
        args: ['p1']
    }));

    await projects.setActiveTasks('p1', 10);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('active_tasks = ?'),
        args: [10, 'p1']
    }));
});

test('isProjectLocked - queries DB if not in cache', async () => {
    const executeSpy = vi.fn(async () => ({ rows: [{ is_locked_for_daily: 1 }] }));
    const cache = new Map();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: cache,
            invalidateProjectStateCache: () => {}
        }
    });

    const result = await projects.isProjectLocked('p1');
    expect(result).toBe(true);
    expect(executeSpy).toHaveBeenCalled();
    expect(cache.get('p1')).toEqual({ is_locked_for_daily: 1 });
});

test('getActiveTasks - queries DB if not in cache', async () => {
    const executeSpy = vi.fn(async () => ({ rows: [{ active_tasks: 3 }] }));
    const cache = new Map();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: cache,
            invalidateProjectStateCache: () => {}
        }
    });

    const result = await projects.getActiveTasks('p1');
    expect(result).toBe(3);
    expect(executeSpy).toHaveBeenCalled();
    expect(cache.get('p1')).toEqual({ active_tasks: 3 });
});

test('getAllProjectStates - retrieves all states and caches them', async () => {
    const executeSpy = vi.fn(async () => ({
        rows: [
            { project_id: 'p1', is_locked_for_daily: 1, active_tasks: 2, locked_at: 100, lock_reason: 'r1' }
        ]
    }));
    const cache = new Map();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectStateCache: cache,
            invalidateProjectStateCache: () => {}
        }
    });

    const result = await projects.getAllProjectStates();
    expect(result).toEqual([
        { projectId: 'p1', is_locked_for_daily: true, active_tasks: 2, lockedAt: 100, lockReason: 'r1' }
    ]);
    expect(cache.get('p1')).toBeDefined();
});

test('listProjectsConfig - list configs from DB', async () => {
    const executeSpy = vi.fn(async () => ({ rows: [{ id: 'p1' }] }));
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectConfigCache: new Map(),
            invalidateProjectConfigCache: () => {}
        }
    });

    const result = await projects.listProjectsConfig();
    expect(result).toEqual([{ id: 'p1' }]);
});

test('getProjectConfig - uses cache and queries DB', async () => {
    const executeSpy = vi.fn(async () => ({ rows: [{ id: 'p1' }] }));
    const cache = new Map();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectConfigCache: cache,
            invalidateProjectConfigCache: () => {}
        }
    });

    // Query 1: DB call
    let result = await projects.getProjectConfig('p1');
    expect(result).toEqual({ id: 'p1' });
    expect(executeSpy).toHaveBeenCalledTimes(1);

    // Query 2: Cache hit
    result = await projects.getProjectConfig('p1');
    expect(result).toEqual({ id: 'p1' });
    expect(executeSpy).toHaveBeenCalledTimes(1);
});

test('updateProjectAutomation - updates config', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const invalidateSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectConfigCache: new Map(),
            invalidateProjectConfigCache: invalidateSpy
        }
    });

    await projects.updateProjectAutomation('p1', {
        buildPipelineEnabled: true,
        pipelineCron: '* * * * *',
        pipelinePrompt: 'prompt',
        conflictResolverEnabled: false,
        conflictResolverCron: '0 0 * * *'
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE projects_config'),
        args: [1, '* * * * *', 'prompt', 0, '0 0 * * *', expect.any(Number), 'p1']
    }));
    expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('deleteProjectConfig - deletes config', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const invalidateSpy = vi.fn();
    const projects = await esmock('../../src/db/projects.js', {
        '../../src/db/core.js': { executeWithRetry: executeSpy },
        '../../src/db/cache.js': {
            projectConfigCache: new Map(),
            invalidateProjectConfigCache: invalidateSpy
        }
    });

    await projects.deleteProjectConfig('p1');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: 'DELETE FROM projects_config WHERE id = ?',
        args: ['p1']
    }));
    expect(invalidateSpy).toHaveBeenCalledWith('p1');
});
