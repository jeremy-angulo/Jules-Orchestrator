import { GLOBAL_CONFIG } from '../src/config.js';
process.env.ORCHESTRATOR_DB_PATH = 'test-db.db';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import {
  initTables,
  initProjectState, lockProject, unlockProject,
  incrementTasks, decrementTasks, isProjectLocked, getActiveTasks
} from '../src/db/database.js';

test('Database operations', async () => {
  await initTables();
  const projectId = 'test-db-project';

  // init
  await initProjectState(projectId);

  // Default values
  assert.strictEqual(await isProjectLocked(projectId), false);
  assert.strictEqual(await getActiveTasks(projectId), 0);

  // Lock / Unlock
  await lockProject(projectId);
  assert.strictEqual(await isProjectLocked(projectId), true);
  await unlockProject(projectId);
  assert.strictEqual(await isProjectLocked(projectId), false);

  // Increment / Decrement
  await incrementTasks(projectId);
  assert.strictEqual(await getActiveTasks(projectId), 1);
  await incrementTasks(projectId);
  assert.strictEqual(await getActiveTasks(projectId), 2);
  await decrementTasks(projectId);
  assert.strictEqual(await getActiveTasks(projectId), 1);
  await decrementTasks(projectId);
  assert.strictEqual(await getActiveTasks(projectId), 0);
  await decrementTasks(projectId); // should not go below 0
  assert.strictEqual(await getActiveTasks(projectId), 0);
});
