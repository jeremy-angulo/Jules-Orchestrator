import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import { GLOBAL_CONFIG } from '../src/config.js';

// Set up config for tests
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
GLOBAL_CONFIG.POLLING_INTERVAL = 10;

const mockProject = {
  id: 'test-project',
  githubRepo: 'test/repo',
};

// We need to use esmock to load the modules with mocked sleep
const { julesAPI, startAndMonitorSession } = await esmock('../src/api/julesClient.js', {
  '../src/utils/helpers.js': {
    sleep: async () => Promise.resolve()
  }
});

// Mock database to avoid real DB access during these tests
import * as db from '../src/db/database.js';

test.beforeEach(() => {
  // We can't easily clear the real DB if it's locked, and we shouldn't in unit tests.
  // We'll rely on mocks if possible or just skip DB clearing for these tests.
});

test('julesAPI - handles network errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Fetch failed'); });

  const result = await julesAPI('TestAgent', '/test');
  assert.strictEqual(result, null);
});

test('julesAPI - handles non-ok status', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ 
    ok: false, 
    status: 401, 
    statusText: 'Unauthorized', 
    text: async () => 'error text',
    json: async () => ({ error: 'error text' })
  }));

  const result = await julesAPI('TestAgent', '/test');
  assert.strictEqual(result, null);
});

test('startAndMonitorSession - fails if session creation fails', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ 
      ok: false, 
      status: 500, 
      statusText: 'Server Error', 
      text: async () => 'error text',
      json: async () => ({ error: 'error text' })
    }));

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
        assert.ok(options.headers['X-Goog-Api-Key'], 'X-Goog-Api-Key header should be present');
        return { ok: true, text: async () => JSON.stringify({ name: 'sessions/123' }) };
      }
      if (callCount === 2) { // First poll -> COMPLETED
        return { ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { title: "My PR", url: "https://github.com/test/repo/pull/123" } }] }) };
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
      return { 
        ok: false, 
        status: 500, 
        statusText: 'Server Error', 
        text: async () => 'error text',
        json: async () => ({ error: 'error text' })
      };
    }
    if (callCount === 3) { // Second poll -> API recovers, status FAILED (to end test)
      return { ok: true, text: async () => JSON.stringify({ state: 'FAILED' }) };
    }
    return { ok: false, status: 500, statusText: 'Unexpected call', text: async () => '' };
  });

  const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
  assert.strictEqual(result, false);
});

test('startAndMonitorSession - handles AWAITING_PLAN_APPROVAL and AWAITING_USER_FEEDBACK', async (t) => {
  let callCount = 0;
  let receivedPlanApproval = false;
  let receivedMessage = false;

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    callCount++;
    if (callCount === 1) { // Session creation
      return { ok: true, text: async () => JSON.stringify({ name: 'sessions/123' }) };
    }
    if (callCount === 2) { // Poll 1 -> AWAITING_PLAN_APPROVAL
      return { ok: true, text: async () => JSON.stringify({ state: 'AWAITING_PLAN_APPROVAL' }) };
    }
    if (callCount === 3) { // approvePlan POST
      receivedPlanApproval = true;
      assert.strictEqual(url.includes(':approvePlan'), true);
      return { ok: true, text: async () => JSON.stringify({}) };
    }
    if (callCount === 4) { // Poll 2 -> AWAITING_USER_FEEDBACK
      return { ok: true, text: async () => JSON.stringify({ state: 'AWAITING_USER_FEEDBACK' }) };
    }
    if (callCount === 5) { // sendMessage POST
      receivedMessage = true;
      assert.strictEqual(url.includes(':sendMessage'), true);
      const body = JSON.parse(options.body);
      assert.strictEqual(body.prompt, 'keep going');
      return { ok: true, text: async () => JSON.stringify({}) };
    }
    if (callCount === 6) { // Poll 3 -> FAILED (to end test)
      return { ok: true, text: async () => JSON.stringify({ state: 'FAILED' }) };
    }
    return { ok: false, status: 500, statusText: 'Unexpected call', text: async () => '' };
  });

  const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
  assert.strictEqual(result, false);
  assert.strictEqual(receivedPlanApproval, true);
  assert.strictEqual(receivedMessage, true);
});
