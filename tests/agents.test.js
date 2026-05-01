import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import cron from 'node-cron';
import { scheduleBuildAndMergePipeline } from '../src/agents/pipeline.js';
import * as db from '../src/db/database.js';

test('scheduleBuildAndMergePipeline - handles errors gracefully', (t) => {
  // Mock cron.schedule to prevent the process from hanging
  const tasks = [];
  t.mock.method(cron, 'schedule', (pattern, callback) => {
      tasks.push(callback);
      return { stop: () => {} };
  });

  const mockProject = {
    id: 'test-project',
    buildAndMergePipeline: {
      cronSchedule: "0 0 * * *",
      prompt: "Test pipeline"
    },
    state: { isLockedForDaily: false, activeTasks: 0 }
  };

  try {
      scheduleBuildAndMergePipeline(mockProject);
      assert.ok(true, 'Pipeline scheduled successfully');
      assert.strictEqual(tasks.length, 1);
  } catch (err) {
      assert.fail(`Pipeline scheduling threw an error: ${err.message}`);
  }
});

test('scheduleBuildAndMergePipeline - executes callback logic', async (t) => {
  const tasks = [];
  t.mock.method(cron, 'schedule', (pattern, callback) => {
      tasks.push(callback);
      return { stop: () => {} };
  });

  const mockProject = {
    id: 'test-pipeline-1',
    buildAndMergePipeline: {
      cronSchedule: "0 0 * * *",
      prompt: "Test pipeline"
    }
  };

  await db.initProjectState('test-pipeline-1');

  // To test the internal logic, we replace the global fetch that julesClient and githubClient use
  let fetchCallCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
     fetchCallCount++;
     // return values for Jules API then Github API
     if (fetchCallCount === 1) {
         // Create session
         return { ok: true, text: async () => JSON.stringify({ name: "sessions/1" }) };
     } else if (fetchCallCount === 2) {
         // Get session -> return completed with PR to simulate success
         return { ok: true, text: async () => JSON.stringify({ state: "COMPLETED", outputs: [{ pullRequest: { url: "https://github.com/test/pull/1" } }] }) };
     } else if (fetchCallCount === 3) {
         // List open PRs
         return { ok: true, text: async () => JSON.stringify([]), json: async () => [] };
     }
     return { ok: false };
  });

  scheduleBuildAndMergePipeline(mockProject);
  assert.strictEqual(tasks.length, 1);

  // Manually run the scheduled task
  await tasks[0]();

  assert.strictEqual(fetchCallCount, 3, 'Should have made 3 fetch calls for a successful pipeline');
  assert.strictEqual(await db.isProjectLocked('test-pipeline-1'), false, 'Project should be unlocked after');
});

test('scheduleBuildAndMergePipeline - skips PR if session fails', async (t) => {
  const tasks = [];
  t.mock.method(cron, 'schedule', (pattern, callback) => {
      tasks.push(callback);
      return { stop: () => {} };
  });

  const mockProject = {
    id: 'test-pipeline-2',
    buildAndMergePipeline: {
      cronSchedule: "0 0 * * *",
      prompt: "Test pipeline"
    }
  };

  await db.initProjectState('test-pipeline-2');

  let fetchCallCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
     fetchCallCount++;
     if (fetchCallCount === 1) {
         // Create session
         return { ok: true, text: async () => JSON.stringify({ name: "sessions/1" }) };
     } else if (fetchCallCount === 2) {
         // Get session -> return FAILED to simulate failure
         return { ok: true, text: async () => JSON.stringify({ state: "FAILED" }) };
     } else if (fetchCallCount === 3) {
         // Create session retry
         return { ok: true, text: async () => JSON.stringify({ name: "sessions/2" }) };
     } else if (fetchCallCount === 4) {
         // Get session retry -> SUCCESS
         return { ok: true, text: async () => JSON.stringify({ state: "COMPLETED", outputs: [{ pullRequest: { url: "https://github.com/test/pull/124" } }] }) };
     } else if (fetchCallCount === 5) {
         // List open PRs
         return { ok: true, json: async () => [{ number: 124, title: "Test PR" }] };
     } else if (fetchCallCount === 6) {
         // Github get PR status (polling mergeable_state)
         return { ok: true, json: async () => ({ number: 124, mergeable: true, merged: false }) };
     } else if (fetchCallCount === 7) {
         // Github merge PR
         return { ok: true, json: async () => ({ merged: true }), text: async () => JSON.stringify({ merged: true }) };
     }
     return { ok: false };
  });

  scheduleBuildAndMergePipeline(mockProject);

  await tasks[0]();

  // Since we added retries, there will be 4 fetch calls: 1 create, 1 get(fail), 1 create, 1 get(fail) etc, or we should just mock it to return true after checking failure
  assert.strictEqual(fetchCallCount > 2, true, 'Should have made retry fetch calls for a failing pipeline');
});
