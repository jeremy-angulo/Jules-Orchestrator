import { GLOBAL_CONFIG } from '../src/config.js';
process.env.ORCHESTRATOR_DB_PATH = 'test-bg.db';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import * as db from '../src/db/database.js';

test('runBackgroundAgent skips if no backgroundPrompts', async () => {
  await db.initTables();
  const { runBackgroundAgent } = await import('../src/agents/background.js');
  const project = { id: 'test', backgroundPrompts: [] };
  await runBackgroundAgent(project);
  assert.ok(true, 'Returns immediately');
});

test('runBackgroundAgent skips if backgroundPrompts is undefined', async () => {
  const { runBackgroundAgent } = await import('../src/agents/background.js');
  const project = { id: 'test' };
  await runBackgroundAgent(project);
  assert.ok(true, 'Returns immediately');
});

test('runBackgroundAgent skips if project locked', async () => {
  let isLockedCalled = false;
  let startCalled = false;
  let sleepCalledCount = 0;

  const { runBackgroundAgent } = await esmock('../src/agents/background.js', {
    '../src/db/database.js': {
      isProjectLocked: async () => {
        isLockedCalled = true;
        return true;
      },
      decrementTasks: async () => { }
    },
    '../src/api/julesClient.js': {
      startAndMonitorSession: async () => {
        startCalled = true;
      }
    },
    '../src/utils/helpers.js': {
      sleep: async () => {
        sleepCalledCount++;
        throw new Error('BREAK_LOOP_ERROR');
      }
    }
  });

  const project = { id: 'test2', backgroundPrompts: ['prompt1'] };

  try {
    await runBackgroundAgent(project);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'BREAK_LOOP_ERROR');
    assert.ok(isLockedCalled, 'isProjectLocked should be called');
    assert.strictEqual(startCalled, false, 'startAndMonitorSession should NOT be called');
  }
});

test('runBackgroundAgent calls startAndMonitorSession if not locked', async () => {
  let isLockedCalled = false;
  let startCalled = false;
  let sleepCalledCount = 0;
  let incrementCalled = false;
  let decrementCalled = false;

  const { runBackgroundAgent } = await esmock('../src/agents/background.js', {
    '../src/db/database.js': {
      isProjectLocked: async () => {
        isLockedCalled = true;
        return false;
      },
      incrementTasks: async () => { incrementCalled = true; },
      decrementTasks: async () => { decrementCalled = true; }
    },
    '../src/api/julesClient.js': {
      startAndMonitorSession: async (prompt, title, proj) => {
        startCalled = true;
        assert.strictEqual(prompt, 'prompt1');
        assert.ok(title.includes('Background Agent'));
        assert.strictEqual(proj.id, 'test2');
      }
    },
    '../src/utils/helpers.js': {
      sleep: async () => {
        sleepCalledCount++;
        throw new Error('BREAK_LOOP_ERROR');
      }
    }
  });

  const project = { id: 'test2', backgroundPrompts: ['prompt1'] };

  try {
    await runBackgroundAgent(project);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'BREAK_LOOP_ERROR');
    assert.ok(isLockedCalled, 'isProjectLocked should be called');
    assert.ok(startCalled, 'startAndMonitorSession should be called');
    assert.ok(incrementCalled, 'incrementTasks should be called');
    assert.ok(decrementCalled, 'decrementTasks should be called');
  }
});

test('runBackgroundAgent calls startAndMonitorSession if not locked, and decrements on error', async () => {
  let isLockedCalled = false;
  let startCalledCount = 0;
  let sleepCalledCount = 0;
  let incrementCalledCount = 0;
  let decrementCalledCount = 0;

  const { runBackgroundAgent } = await esmock('../src/agents/background.js', {
    '../src/db/database.js': {
      isProjectLocked: async () => {
        isLockedCalled = true;
        return false;
      },
      incrementTasks: async () => { incrementCalledCount++; },
      decrementTasks: async () => { decrementCalledCount++; }
    },
    '../src/api/julesClient.js': {
      startAndMonitorSession: async () => {
        startCalledCount++;
        throw new Error('API_ERROR');
      }
    },
    '../src/utils/helpers.js': {
      sleep: async () => {
        sleepCalledCount++;
        // This is the sleep inside the catch block. Throw to break the loop.
        throw new Error('BREAK_LOOP_ERROR');
      }
    }
  });

  const project = { id: 'test2', backgroundPrompts: ['prompt1'] };

  try {
    await runBackgroundAgent(project);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'BREAK_LOOP_ERROR');
    assert.ok(isLockedCalled, 'isProjectLocked should be called');
    assert.strictEqual(startCalledCount, 1, 'startAndMonitorSession should be called');
    assert.strictEqual(incrementCalledCount, 1, 'incrementTasks should be called once');
    assert.strictEqual(decrementCalledCount, 1, 'decrementTasks should be called once in catch block');
    assert.strictEqual(sleepCalledCount, 1, 'sleep should be called once in catch block');
  }
});
