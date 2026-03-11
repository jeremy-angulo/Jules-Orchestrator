import test from 'node:test';
import assert from 'node:assert';
import { getNextGitHubIssue, closeGitHubIssue, createAndMergePR } from '../src/api/githubClient.js';

const mockProject = {
  id: 'test-project',
  githubRepo: 'test/repo',
  githubToken: 'fake-token'
};

test('getNextGitHubIssue - success', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    return {
      ok: true,
      json: async () => [{ number: 1, title: 'Test Issue' }, { number: 2, title: 'PR', pull_request: {} }]
    };
  };

  const issue = await getNextGitHubIssue(mockProject);
  assert.deepStrictEqual(issue, { number: 1, title: 'Test Issue' });

  global.fetch = originalFetch;
});

test('getNextGitHubIssue - not ok response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });

  const issue = await getNextGitHubIssue(mockProject);
  assert.strictEqual(issue, null);

  global.fetch = originalFetch;
});

test('getNextGitHubIssue - network error', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Network failure'); };

  const issue = await getNextGitHubIssue(mockProject);
  assert.strictEqual(issue, null);

  global.fetch = originalFetch;
});

test('closeGitHubIssue - handles network error gracefully', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Network failure'); };

  // Should not throw
  await closeGitHubIssue(mockProject, 1);

  global.fetch = originalFetch;
});

test('createAndMergePR - handles non-JSON errors gracefully', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    return {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new Error('Not JSON'); }
    };
  };

  // createAndMergePR catches its own errors internally and logs them, we just ensure it doesn't crash the app.
  await createAndMergePR(mockProject, 'dev', 'main');

  global.fetch = originalFetch;
});

test('createAndMergePR - success (happy path)', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/pulls')) {
      return {
        ok: true,
        json: async () => ({ number: 123 })
      };
    } else if (url.endsWith('/pulls/123/merge')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK'
      };
    }
    throw new Error('Unexpected URL: ' + url);
  });

  await createAndMergePR(mockProject, 'dev', 'main');
  assert.strictEqual(fetchMock.mock.calls.length, 2);
});

test('createAndMergePR - handles "No commits between" gracefully', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/pulls')) {
      return {
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({
          errors: [{ message: 'No commits between dev and main' }]
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  });

  await createAndMergePR(mockProject, 'dev', 'main');
  assert.strictEqual(fetchMock.mock.calls.length, 1);
});

test('createAndMergePR - handles PR creation JSON error', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/pulls')) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          message: 'Validation Failed',
          errors: [{ message: 'Some other error' }]
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  });

  await createAndMergePR(mockProject, 'dev', 'main');
  assert.strictEqual(fetchMock.mock.calls.length, 1);
});

test('createAndMergePR - handles auto-merge failure gracefully', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/pulls')) {
      return {
        ok: true,
        json: async () => ({ number: 456 })
      };
    } else if (url.endsWith('/pulls/456/merge')) {
      return {
        ok: false,
        status: 405,
        statusText: 'Method Not Allowed'
      };
    }
    throw new Error('Unexpected URL: ' + url);
  });

  await createAndMergePR(mockProject, 'dev', 'main');
  assert.strictEqual(fetchMock.mock.calls.length, 2);
});
