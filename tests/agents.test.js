import { GLOBAL_CONFIG } from '../src/config.js';
process.env.ORCHESTRATOR_DB_PATH = 'test-agents.db';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import cron from 'node-cron';
import esmock from 'esmock';
import * as db from '../src/db/database.js';

test('scheduleBuildAndMergePipeline - handles errors gracefully', async (t) => {
  await db.initTables();
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

  const { scheduleBuildAndMergePipeline } = await import('../src/agents/pipeline.js');

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

  let sessionCalled = false;
  let mergeCalled = false;

  const { scheduleBuildAndMergePipeline } = await esmock('../src/agents/pipeline.js', {
      '../src/api/julesClient.js': {
          startAndMonitorSession: async () => {
              sessionCalled = true;
              return true; // Simulate success
          }
      },
      '../src/api/githubClient.js': {
          mergeOpenPRs: async () => {
              mergeCalled = true;
          }
      }
  });

  scheduleBuildAndMergePipeline(mockProject);
  assert.strictEqual(tasks.length, 1);

  await tasks[0]();

  assert.strictEqual(sessionCalled, true);
  assert.strictEqual(mergeCalled, true);
  assert.strictEqual(await db.isProjectLocked('test-pipeline-1'), false);
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

  let sessionCallCount = 0;
  let mergeCalled = false;

  const { scheduleBuildAndMergePipeline } = await esmock('../src/agents/pipeline.js', {
      '../src/api/julesClient.js': {
          startAndMonitorSession: async () => {
              sessionCallCount++;
              if (sessionCallCount === 1) return false;
              if (sessionCallCount === 2) return true;
              return false;
          }
      },
      '../src/utils/helpers.js': {
          sleep: async () => {} // Mock sleep to avoid waiting 30 seconds
      },
      '../src/api/githubClient.js': {
          mergeOpenPRs: async () => {
              mergeCalled = true;
          }
      }
  });

  scheduleBuildAndMergePipeline(mockProject);
  assert.strictEqual(tasks.length, 1);

  await tasks[0]();

  assert.strictEqual(sessionCallCount, 2, 'Should have retried session creation');
  assert.strictEqual(mergeCalled, true, 'Should have called merge after retry success');
  assert.strictEqual(await db.isProjectLocked('test-pipeline-2'), false);
});
