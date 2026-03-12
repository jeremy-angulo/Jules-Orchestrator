import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import {
  initProjectState, lockProject, unlockProject,
  incrementTasks, decrementTasks, isProjectLocked, getActiveTasks
} from '../src/db/database.js';

test('Database operations', () => {
  const projectId = 'test-db-project';

  // init
  initProjectState(projectId);

  // Default values
  assert.strictEqual(isProjectLocked(projectId), false);
  assert.strictEqual(getActiveTasks(projectId), 0);

  // Lock / Unlock
  lockProject(projectId);
  assert.strictEqual(isProjectLocked(projectId), true);
  unlockProject(projectId);
  assert.strictEqual(isProjectLocked(projectId), false);

  // Increment / Decrement
  incrementTasks(projectId);
  assert.strictEqual(getActiveTasks(projectId), 1);
  incrementTasks(projectId);
  assert.strictEqual(getActiveTasks(projectId), 2);
  decrementTasks(projectId);
  assert.strictEqual(getActiveTasks(projectId), 1);
  decrementTasks(projectId);
  assert.strictEqual(getActiveTasks(projectId), 0);
  decrementTasks(projectId); // should not go below 0
  assert.strictEqual(getActiveTasks(projectId), 0);
});
