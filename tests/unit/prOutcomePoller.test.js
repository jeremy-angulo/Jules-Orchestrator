import test from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';

test('prOutcomePoller - runPROutcomeCycle updates status when PR is merged', async (t) => {
  const sqlCalls = [];
  const now = Date.now();
  const mockRows = [
    { id: 1, project_id: 'p1', pr_url: 'https://github.com/owner/repo/pull/123', pr_status: 'open', ended_at: now }
  ];

  const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
    '../../src/db/core.js': {
      executeWithRetry: async (stmt) => {
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        const args = typeof stmt === 'string' ? [] : (stmt.args || []);
        sqlCalls.push({ sql, args });
        if (sql.includes('SELECT')) {
          return { rows: mockRows };
        }
        return { rows: [] };
      }
    },
    '../../src/utils/logger.js': {
      log: () => {}
    }
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    return {
      ok: true,
      json: async () => ({ merged: true, state: 'closed' })
    };
  };

  try {
    const projectById = new Map();
    projectById.set('p1', { githubRepo: 'owner/repo', githubToken: 'token123' });

    const originalDateNow = Date.now;
    Date.now = () => now;

    try {
        await prOutcomePoller.runPROutcomeCycle(projectById);
    } finally {
        Date.now = originalDateNow;
    }

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    assert.ok(updateCall, 'Should have called UPDATE');
    assert.deepEqual(updateCall.args, ['merged', 1]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('prOutcomePoller - runPROutcomeCycle handles fetch error gracefully', async (t) => {
  const sqlCalls = [];
  const now = Date.now();
  const mockRows = [
    { id: 1, project_id: 'p1', pr_url: 'https://github.com/owner/repo/pull/123', pr_status: 'open', ended_at: now }
  ];

  const prOutcomePoller = await esmock('../../src/services/prOutcomePoller.js', {
    '../../src/db/core.js': {
      executeWithRetry: async (stmt) => {
        const sql = typeof stmt === 'string' ? stmt : stmt.sql;
        const args = typeof stmt === 'string' ? [] : (stmt.args || []);
        sqlCalls.push({ sql, args });
        if (sql.includes('SELECT')) {
          return { rows: mockRows };
        }
        return { rows: [] };
      }
    },
    '../../src/utils/logger.js': {
      log: () => {}
    }
  });

  const originalFetch = global.fetch;
  global.fetch = async () => {
    return { ok: false };
  };

  try {
    const projectById = new Map();
    projectById.set('p1', { githubRepo: 'owner/repo', githubToken: 'token123' });

    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
        await prOutcomePoller.runPROutcomeCycle(projectById);
    } finally {
        Date.now = originalDateNow;
    }

    const updateCall = sqlCalls.find(c => c.sql.includes('UPDATE'));
    assert.strictEqual(updateCall, undefined, 'Should NOT have called UPDATE on fetch error');
  } finally {
    global.fetch = originalFetch;
  }
});
