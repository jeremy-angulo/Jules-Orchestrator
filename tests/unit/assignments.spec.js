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
