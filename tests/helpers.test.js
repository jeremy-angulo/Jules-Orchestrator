import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_API_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import { sleep } from '../src/utils/helpers.js';

test('sleep resolves after given time', async () => {
  const start = Date.now();
  await sleep(100);
  const end = Date.now();
  assert.ok(end - start >= 90, 'sleep should wait at least 90ms');
});
