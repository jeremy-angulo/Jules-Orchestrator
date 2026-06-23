import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('recordAgentSessionStart - inserts a new session record', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeSpy
        }
    });

    await sessions.recordAgentSessionStart({
        assignmentId: 1,
        projectId: 'p1',
        agentName: 'Agent A',
        sessionId: 's1',
        tokenIndex: 0
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO agent_sessions'),
        args: expect.arrayContaining(['s1', 1, 'p1', 'Agent A', 0])
    }));
});

test('recordAgentSessionEnd - updates session status', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeSpy
        }
    });

    await sessions.recordAgentSessionEnd('s1', 'completed');

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE agent_sessions'),
        args: expect.arrayContaining(['completed', 's1'])
    }));
});

test('getAgentSessionsByStatus - retrieves sessions by status', async () => {
    const mockRows = [{ session_id: 's1', status: 'running' }];
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: async () => ({ rows: mockRows })
        }
    });

    const result = await sessions.getAgentSessionsByStatus('running');
    expect(result).toEqual(mockRows);
});

test('listAgentSessions - lists sessions for a project', async () => {
    const mockRows = [{ session_id: 's1', project_id: 'p1' }];
    const executeSpy = vi.fn(async () => ({ rows: mockRows }));
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeSpy
        }
    });

    const result = await sessions.listAgentSessions('p1');
    expect(result).toEqual(mockRows);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        args: expect.arrayContaining(['p1'])
    }));
});

test('getLastAgentSession - returns the most recent session for an assignment', async () => {
    const mockRows = [{ session_id: 's2', assignment_id: 1 }];
    const executeSpy = vi.fn(async () => ({ rows: mockRows }));
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeSpy
        }
    });

    const result = await sessions.getLastAgentSession(1);
    expect(result).toEqual(mockRows[0]);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        args: expect.arrayContaining([1])
    }));
});

test('createJournalEntry - inserts a running entry', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeSpy
        }
    });

    await sessions.createJournalEntry({
        sessionId: 'j1',
        assignmentId: 2,
        projectId: 'p2',
        agentName: 'Agent B',
        intent: 'Test Intent'
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO journal'),
        args: expect.arrayContaining(['j1', 2, 'p2', 'Agent B', 'Test Intent'])
    }));

    // Check for hardcoded status in SQL string
    const sqlCall = executeSpy.mock.calls[0][0].sql;
    expect(sqlCall).toContain("'running'");
});

test('closeJournalEntry - updates journal entry', async () => {
    const executeSpy = vi.fn(async () => ({}));
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeSpy
        }
    });

    await sessions.closeJournalEntry('j1', {
        status: 'completed',
        summary: 'Done',
        prUrl: 'https://github.com/pr/1',
        metadata: { foo: 'bar' }
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE journal'),
        args: expect.arrayContaining(['Done', 'completed', 'https://github.com/pr/1', JSON.stringify({ foo: 'bar' }), 'j1'])
    }));
});

test('getJournalEntry - returns entry with parsed metadata', async () => {
    const mockRows = [{
        session_id: 'j1',
        metadata: JSON.stringify({ key: 'val' })
    }];
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: async () => ({ rows: mockRows })
        }
    });

    const result = await sessions.getJournalEntry('j1');
    expect(result.session_id).toBe('j1');
    expect(result.metadata).toEqual({ key: 'val' });
});

test('getJournalEntry - returns null if not found', async () => {
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: async () => ({ rows: [] })
        }
    });

    const result = await sessions.getJournalEntry('none');
    expect(result).toBeNull();
});

test('listJournalByProject - returns project entries with parsed metadata', async () => {
    const mockRows = [
        { session_id: 'j1', metadata: JSON.stringify({ a: 1 }) },
        { session_id: 'j2', metadata: null }
    ];
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: async () => ({ rows: mockRows })
        }
    });

    const result = await sessions.listJournalByProject('p1', 10);
    expect(result).toHaveLength(2);
    expect(result[0].metadata).toEqual({ a: 1 });
    expect(result[1].metadata).toBeNull();
});

test('listJournalByAssignment - returns assignment entries with parsed metadata', async () => {
    const mockRows = [
        { session_id: 'j3', metadata: JSON.stringify({ b: 2 }) }
    ];
    const sessions = await esmock('../../src/db/sessions.js', {
        '../../src/db/core.js': {
            executeWithRetry: async () => ({ rows: mockRows })
        }
    });

    const result = await sessions.listJournalByAssignment(1, 5);
    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({ b: 2 });
});
