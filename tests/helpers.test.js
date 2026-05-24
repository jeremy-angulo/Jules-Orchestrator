import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import { sleep, sleepInterruptible } from '../src/utils/helpers.js';

test('sleep resolves after given time', async () => {
  const start = Date.now();
  await sleep(100);
  const end = Date.now();
  assert.ok(end - start >= 90, 'sleep should wait at least 90ms');
});

test('sleepInterruptible resolves successfully if not interrupted', async () => {
  const start = Date.now();
  const shouldStop = () => false;
  const result = await sleepInterruptible(100, shouldStop, 50);
  const end = Date.now();

  assert.strictEqual(result, true, 'sleepInterruptible should return true if not interrupted');
  assert.ok(end - start >= 90, 'sleepInterruptible should wait at least 90ms');
});

test('sleepInterruptible resolves early and returns false if interrupted', async () => {
  const start = Date.now();
  let calls = 0;
  const shouldStop = () => {
    calls++;
    return calls > 1; // Interrupt on second check
  };

  const result = await sleepInterruptible(1000, shouldStop, 100);
  const end = Date.now();

  assert.strictEqual(result, false, 'sleepInterruptible should return false if interrupted');
  assert.ok(end - start < 500, 'sleepInterruptible should resolve early');
});
