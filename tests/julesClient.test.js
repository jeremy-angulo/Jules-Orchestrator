import test from 'node:test';
import assert from 'node:assert';
import { julesAPI, startAndMonitorSession } from '../src/api/julesClient.js';
import { GLOBAL_CONFIG } from '../src/config.js';

const mockProject = {
  id: 'test-project',
  githubRepo: 'test/repo',
};

// Replace polling interval for faster tests
GLOBAL_CONFIG.POLLING_INTERVAL = 10;

test('julesAPI - handles network errors', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Fetch failed'); };

  const result = await julesAPI('/test');
  assert.strictEqual(result, null);

  global.fetch = originalFetch;
});

test('julesAPI - handles non-ok status', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });

  const result = await julesAPI('/test');
  assert.strictEqual(result, null);

  global.fetch = originalFetch;
});

test('startAndMonitorSession - fails if session creation fails', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Server Error' });

    const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
    assert.strictEqual(result, false);

    global.fetch = originalFetch;
});

test('startAndMonitorSession - completes successfully', async () => {
    const originalFetch = global.fetch;
    let callCount = 0;

    global.fetch = async (url, options) => {
      callCount++;
      if (callCount === 1) { // Session creation
        return { ok: true, json: async () => ({ name: 'sessions/123' }) };
      }
      if (callCount === 2) { // First poll -> WAITING_FOR_USER_INPUT
        return { ok: true, json: async () => ({ state: 'AWAITING_USER_FEEDBACK' }) };
      }
      if (callCount === 3) { // Send message response
         return { ok: true, json: async () => ({}) };
      }
      if (callCount === 4) { // Second poll -> COMPLETED
        return { ok: true, json: async () => ({ state: 'COMPLETED' }) };
      }
      return { ok: false, status: 500, statusText: 'Unexpected call' };
    };

    const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
    assert.strictEqual(result, true);

    global.fetch = originalFetch;
});

test('startAndMonitorSession - fails when session status is FAILED', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async (url, options) => {
    callCount++;
    if (callCount === 1) { // Session creation
      return { ok: true, json: async () => ({ name: 'sessions/123' }) };
    }
    if (callCount === 2) { // First poll -> FAILED
      return { ok: true, json: async () => ({ state: 'FAILED' }) };
    }
    return { ok: false, status: 500, statusText: 'Unexpected call' };
  };

  const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
  assert.strictEqual(result, false);

  global.fetch = originalFetch;
});

test('startAndMonitorSession - handles missing state (null) robustly', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async (url, options) => {
    callCount++;
    if (callCount === 1) { // Session creation
      return { ok: true, json: async () => ({ name: 'sessions/123' }) };
    }
    if (callCount === 2) { // First poll -> API returns 500 Error, so julesAPI returns null
      return { ok: false, status: 500, statusText: 'Server Error' };
    }
    if (callCount === 3) { // Second poll -> API recovers, status FAILED (to end test)
      return { ok: true, json: async () => ({ state: 'FAILED' }) };
    }
    return { ok: false, status: 500, statusText: 'Unexpected call' };
  };

  const result = await startAndMonitorSession('instruction', 'Test Agent', mockProject);
  assert.strictEqual(result, false);

  global.fetch = originalFetch;
});
