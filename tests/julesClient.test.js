import { test, after } from 'node:test';
import assert from 'node:assert';
import { GLOBAL_CONFIG } from '../src/config.js';
import { julesAPI } from '../src/api/julesClient.js';

// Mock the token in GLOBAL_CONFIG for deterministic tests
const originalToken = GLOBAL_CONFIG.JULES_API_TOKEN;
GLOBAL_CONFIG.JULES_API_TOKEN = 'test-token';

test('julesAPI performs a GET request by default', async (t) => {
  const mockResponseData = { data: 'success' };

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.strictEqual(url, 'https://jules.googleapis.com/v1alpha/test-endpoint');
    assert.strictEqual(options.method, 'GET');
    assert.strictEqual(options.headers['Authorization'], 'Bearer test-token');
    assert.strictEqual(options.headers['Content-Type'], 'application/json');

    return {
      ok: true,
      status: 200,
      json: async () => mockResponseData
    };
  });

  const result = await julesAPI('/test-endpoint');

  assert.strictEqual(fetchMock.mock.callCount(), 1);
  assert.deepStrictEqual(result, mockResponseData);
});

test('julesAPI performs a POST request with body', async (t) => {
  const mockResponseData = { id: '123' };
  const requestBody = { name: 'test' };

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.strictEqual(url, 'https://jules.googleapis.com/v1alpha/sessions');
    assert.strictEqual(options.method, 'POST');
    assert.strictEqual(options.headers['Authorization'], 'Bearer test-token');
    assert.strictEqual(options.body, JSON.stringify(requestBody));

    return {
      ok: true,
      status: 201,
      json: async () => mockResponseData
    };
  });

  const result = await julesAPI('/sessions', 'POST', requestBody);

  assert.strictEqual(fetchMock.mock.callCount(), 1);
  assert.deepStrictEqual(result, mockResponseData);
});

test('julesAPI handles non-OK status codes', async (t) => {
  const mockErrorResponse = { error: 'Unauthorized' };

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    return {
      ok: false,
      status: 401,
      json: async () => mockErrorResponse
    };
  });

  const result = await julesAPI('/protected');

  assert.strictEqual(fetchMock.mock.callCount(), 1);
  assert.deepStrictEqual(result, mockErrorResponse);
});

test('julesAPI handles network failures', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Network Error');
  });

  await assert.rejects(
    async () => await julesAPI('/any'),
    { message: 'Network Error' }
  );

  assert.strictEqual(fetchMock.mock.callCount(), 1);
});

// Restore original token after tests
after(() => {
  GLOBAL_CONFIG.JULES_API_TOKEN = originalToken;
});
