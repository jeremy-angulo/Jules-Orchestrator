import test from 'node:test';
import assert from 'node:assert';
import { getNextGitHubIssue, closeGitHubIssue, createAndMergePR } from '../src/api/githubClient.js';

const mockProject = {
  id: 'test-project',
  githubRepo: 'test/repo',
  githubToken: 'fake-token'
};

test('getNextGitHubIssue - success', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    return {
      ok: true,
      json: async () => [{ number: 1, title: 'Test Issue' }, { number: 2, title: 'PR', pull_request: {} }]
    };
  });

  const issue = await getNextGitHubIssue(mockProject);
  assert.deepStrictEqual(issue, { number: 1, title: 'Test Issue' });
});

test('getNextGitHubIssue - not ok response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' }));

  const issue = await getNextGitHubIssue(mockProject);
  assert.strictEqual(issue, null);
});

test('getNextGitHubIssue - network error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network failure'); });

  const issue = await getNextGitHubIssue(mockProject);
  assert.strictEqual(issue, null);
});

test('closeGitHubIssue - handles network error gracefully', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network failure'); });

  // Should not throw
  await closeGitHubIssue(mockProject, 1);
});

test('createAndMergePR - handles non-JSON errors gracefully', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    return {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new Error('Not JSON'); }
    };
  });

  // createAndMergePR catches its own errors internally and logs them, we just ensure it doesn't crash the app.
  await createAndMergePR(mockProject, 'dev', 'main');
});

test('getNextGitHubIssue - returns null if only pull requests exist', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    return {
      ok: true,
      json: async () => [{ number: 1, title: 'PR 1', pull_request: {} }, { number: 2, title: 'PR 2', pull_request: {} }]
    };
  });

  const issue = await getNextGitHubIssue(mockProject);
  assert.strictEqual(issue, null);
});

test('getNextGitHubIssue - returns null if list is empty', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    return {
      ok: true,
      json: async () => []
    };
  });

  const issue = await getNextGitHubIssue(mockProject);
  assert.strictEqual(issue, null);
});
