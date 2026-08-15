import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('listAssignments - uses cache if available', async () => {
  const executeSpy = vi.fn();
  const mockCache = new Map([['all', [{ id: 1 }]]]);
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: mockCache,
      invalidateAssignmentCache: vi.fn()
    }
  });

  const result = await assignments.listAssignments();
  expect(result).toEqual([{ id: 1 }]);
  expect(executeSpy).not.toHaveBeenCalled();
});

test('listAssignments - fetches from DB if not in cache', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ id: 2 }] }));
  const mockCache = new Map();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: mockCache,
      invalidateAssignmentCache: vi.fn()
    }
  });

  const result = await assignments.listAssignments('p1');
  expect(result).toEqual([{ id: 2 }]);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('WHERE a.project_id = ?'),
    args: ['p1']
  }));
  expect(mockCache.get('p1')).toEqual([{ id: 2 }]);
});

test('listAssignments - fetches all from DB if pid is not provided', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ id: 10 }, { id: 11 }] }));
  const mockCache = new Map();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: mockCache,
      invalidateAssignmentCache: vi.fn()
    }
  });

  const result = await assignments.listAssignments();
  expect(result).toEqual([{ id: 10 }, { id: 11 }]);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.not.stringContaining('WHERE a.project_id = ?'),
    args: []
  }));
  expect(mockCache.get('all')).toEqual([{ id: 10 }, { id: 11 }]);
});

test('getAssignment - fetches assignment by ID', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ id: 123, agent_id: 'a1' }] }));
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: vi.fn()
    }
  });

  const result = await assignments.getAssignment(123);
  expect(result).toEqual({ id: 123, agent_id: 'a1' });
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('WHERE a.id = ?'),
    args: [123]
  }));
});

test('getAssignment - returns undefined if assignment not found', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [] }));
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: vi.fn()
    }
  });

  const result = await assignments.getAssignment(999);
  expect(result).toBeUndefined();
});

test('createAssignment - inserts and invalidates cache', async () => {
  const executeSpy = vi.fn(async () => ({ lastInsertRowid: 789 }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  const newAssignment = {
    project_id: 'p1',
    agent_id: 'a1',
    mode: 'loop',
    wait_for_pr_merge: true
  };

  const id = await assignments.createAssignment(newAssignment);
  expect(id).toBe(789);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('INSERT INTO assignments'),
    args: expect.arrayContaining(['p1', 'a1', 'loop', 1]) // 1 for wait_for_pr_merge
  }));
  expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('createAssignment - handles defaults for enabled, concurrency, and lastInsertRowid fallback', async () => {
  const executeSpy = vi.fn(async () => ({ lastInsertRowid: undefined }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  const newAssignment = {
    project_id: 'p1',
    agent_id: 'a1',
    mode: 'once'
    // enabled, concurrency, wait_for_pr_merge, custom_prompt not passed
  };

  const id = await assignments.createAssignment(newAssignment);
  expect(id).toBeNull();
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('INSERT INTO assignments'),
    args: expect.arrayContaining(['p1', 'a1', 'once', undefined, undefined, 1, 1, 0, expect.any(Number), expect.any(Number), undefined])
  }));
  expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('updateAssignment - updates and invalidates cache', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ project_id: 'p1' }] }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  const updateData = {
    agent_id: 'a2',
    wait_for_pr_merge: false,
    enabled: true
  };

  await assignments.updateAssignment(456, updateData);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('UPDATE assignments SET'),
    args: expect.arrayContaining(['a2', 0, 456]) // 0 for wait_for_pr_merge
  }));
  expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('updateAssignment - handles default concurrency and missing project_id gracefully', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [] }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  const updateData = {
    agent_id: 'a2',
    custom_prompt: 'prompt',
    mode: 'cron',
    loop_pause_ms: 5000,
    cron_schedule: '* * * * *',
    enabled: false
  };

  await assignments.updateAssignment(789, updateData);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('UPDATE assignments SET'),
    args: expect.arrayContaining(['a2', 'prompt', 'cron', 5000, '* * * * *', 0, 1, 0, expect.any(Number), 789])
  }));
  expect(invalidateSpy).toHaveBeenCalledWith(undefined);
});

test('deleteAssignment - deletes and invalidates cache', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ project_id: 'p1' }] }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  await assignments.deleteAssignment(111);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('DELETE FROM assignments WHERE id = ?'),
    args: [111]
  }));
  expect(invalidateSpy).toHaveBeenCalledWith('p1');
});

test('deleteAssignmentsByProject - deletes assignments by project ID and invalidates cache', async () => {
  const executeSpy = vi.fn(async () => ({}));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  await assignments.deleteAssignmentsByProject('p_target');
  expect(executeSpy).toHaveBeenCalledWith({
    sql: 'DELETE FROM assignments WHERE project_id = ?',
    args: ['p_target']
  });
  expect(invalidateSpy).toHaveBeenCalledWith('p_target');
});

test('toggleAssignment - toggles enabled state', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ project_id: 'p2' }] }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  await assignments.toggleAssignment(222, true);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('UPDATE assignments SET enabled = ?'),
    args: expect.arrayContaining([1, 222])
  }));
  expect(invalidateSpy).toHaveBeenCalledWith('p2');
});

test('recordAssignmentRun - updates run stats', async () => {
  const executeSpy = vi.fn(async () => ({ rows: [{ project_id: 'p3' }] }));
  const invalidateSpy = vi.fn();
  const assignments = await esmock('../../src/db/assignments.js', {
    '../../src/db/core.js': { executeWithRetry: executeSpy },
    '../../src/db/cache.js': {
      assignmentListCache: new Map(),
      invalidateAssignmentCache: invalidateSpy
    }
  });

  await assignments.recordAssignmentRun(333);
  expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
    sql: expect.stringContaining('UPDATE assignments SET last_run_at = ?, total_runs = total_runs + 1'),
    args: expect.arrayContaining([333])
  }));
  expect(invalidateSpy).toHaveBeenCalledWith('p3');
});
