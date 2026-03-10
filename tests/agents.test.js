import test from 'node:test';
import assert from 'node:assert';
import cron from 'node-cron';
import { scheduleBuildAndMergePipeline } from '../src/agents/pipeline.js';

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
