import test from 'node:test';
import assert from 'node:assert';
import { runBackgroundAgent } from '../src/agents/background.js';

test('runBackgroundAgent should return if backgroundPrompts is missing', async (t) => {
  const project = {
    id: 'test-project',
    state: { activeTasks: 0, isLockedForDaily: false }
  };

  // After the fix, this should return without throwing
  await runBackgroundAgent(project);
  assert.ok(true, 'runBackgroundAgent returned successfully');
});

test('runBackgroundAgent should return if backgroundPrompts is empty', async (t) => {
  const project = {
    id: 'test-project',
    state: { activeTasks: 0, isLockedForDaily: false },
    backgroundPrompts: []
  };

  // After the fix, this should return without throwing
  await runBackgroundAgent(project);
  assert.ok(true, 'runBackgroundAgent returned successfully');
});
