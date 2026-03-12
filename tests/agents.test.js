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
      cronSchedule: "0 5 * * *",
      sourceBranch: "dev",
      targetBranch: "preview",
      prompt: "test"
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
      cronSchedule: "0 5 * * *",
      sourceBranch: "dev",
      targetBranch: "preview",
      prompt: "Test {sourceBranch} to {targetBranch}"
    }
  };

  db.initProjectState('test-pipeline-1');

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
         return { ok: true, text: async () => JSON.stringify({ state: "COMPLETED", outputs: [{ pullRequest: {} }] }) };
     } else if (fetchCallCount === 3) {
         // Github create PR
         return { ok: true, json: async () => ({ number: 123 }) };
     } else if (fetchCallCount === 4) {
         // Github merge PR
         return { ok: true };
     }
     return { ok: false };
  });

  scheduleBuildAndMergePipeline(mockProject);
  assert.strictEqual(tasks.length, 1);

  // Manually run the scheduled task
  await tasks[0]();

  assert.strictEqual(fetchCallCount, 4, 'Should have made 4 fetch calls for a successful pipeline');
  assert.strictEqual(db.isProjectLocked('test-pipeline-1'), false, 'Project should be unlocked after');
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
      cronSchedule: "0 5 * * *",
      sourceBranch: "dev",
      targetBranch: "preview",
      prompt: "test"
    }
  };

  db.initProjectState('test-pipeline-2');

  let fetchCallCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
     fetchCallCount++;
     if (fetchCallCount === 1) {
         // Create session
         return { ok: true, text: async () => JSON.stringify({ name: "sessions/1" }) };
     } else if (fetchCallCount === 2) {
         // Get session -> return FAILED to simulate failure
         return { ok: true, text: async () => JSON.stringify({ state: "FAILED" }) };
     }
     return { ok: false };
  });

  scheduleBuildAndMergePipeline(mockProject);

  await tasks[0]();

  assert.strictEqual(fetchCallCount, 2, 'Should only make 2 fetch calls for a failing pipeline (create, then fail)');
});
