import test from 'node:test';
import assert from 'node:assert';
import { julesAPI, startAndMonitorSession } from '../src/api/julesClient.js';
import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];

const mockProject = {
  id: 'test-project',
  githubRepo: 'test/repo',
};

// Replace polling interval for faster tests
GLOBAL_CONFIG.POLLING_INTERVAL = 10;

test('julesAPI - handles network errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Fetch failed'); });

  const result = await julesAPI('/test');
  assert.strictEqual(result, null);
});

test('julesAPI - handles non-ok status', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'error text' }));

  const result = await julesAPI('/test');
  assert.strictEqual(result, null);
});

test('startAndMonitorSession - fails if session creation fails', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, statusText: 'Server Error', text: async () => 'error text' }));

    const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
    assert.strictEqual(result, false);
});

test('startAndMonitorSession - completes successfully and verifies PR', async (t) => {
    let callCount = 0;

    t.mock.method(globalThis, 'fetch', async (url, options) => {
      callCount++;
      if (callCount === 1) { // Session creation
        const body = JSON.parse(options.body);
        assert.strictEqual(body.sourceContext.source, 'sources/github/test/repo', 'Source ID should match API format with slashes');
        return { ok: true, text: async () => JSON.stringify({ name: 'sessions/123' }) };
      }
      if (callCount === 2) { // First poll -> COMPLETED
        return { ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { title: "My PR" } }] }) };
      }
      return { ok: false, status: 500, statusText: 'Unexpected call', text: async () => '' };
    });

    const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
    assert.strictEqual(result, true);
});

test('startAndMonitorSession - fails if no PR detected on COMPLETED', async (t) => {
    let callCount = 0;

    t.mock.method(globalThis, 'fetch', async (url, options) => {
      callCount++;
      if (callCount === 1) { // Session creation
        return { ok: true, text: async () => JSON.stringify({ name: 'sessions/123' }) };
      }
      if (callCount === 2) { // First poll -> COMPLETED but no PR in outputs
        return { ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ somethingElse: "Not a PR" }] }) };
      }
      return { ok: false, status: 500, statusText: 'Unexpected call', text: async () => '' };
    });

    const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
    assert.strictEqual(result, false);
});

test('startAndMonitorSession - fails when session status is FAILED', async (t) => {
  let callCount = 0;

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    callCount++;
    if (callCount === 1) { // Session creation
      return { ok: true, text: async () => JSON.stringify({ name: 'sessions/123' }) };
    }
    if (callCount === 2) { // First poll -> FAILED
      return { ok: true, text: async () => JSON.stringify({ state: 'FAILED' }) };
    }
    return { ok: false, status: 500, statusText: 'Unexpected call', text: async () => '' };
  });

  const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
  assert.strictEqual(result, false);
});

test('startAndMonitorSession - handles missing state (null) robustly', async (t) => {
  let callCount = 0;

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    callCount++;
    if (callCount === 1) { // Session creation
      return { ok: true, text: async () => JSON.stringify({ name: 'sessions/123' }) };
    }
    if (callCount === 2) { // First poll -> API returns 500 Error, so julesAPI returns null
      return { ok: false, status: 500, statusText: 'Server Error', text: async () => 'error text' };
    }
    if (callCount === 3) { // Second poll -> API recovers, status FAILED (to end test)
      return { ok: true, text: async () => JSON.stringify({ state: 'FAILED' }) };
    }
    return { ok: false, status: 500, statusText: 'Unexpected call', text: async () => '' };
  });

  const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
  assert.strictEqual(result, false);
});
