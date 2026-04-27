
import test from 'node:test';
import assert from 'node:assert';
import { GLOBAL_CONFIG } from '../src/config.js';

GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];

test('config exports GLOBAL_CONFIG', () => {
  assert.ok(GLOBAL_CONFIG, 'GLOBAL_CONFIG should exist');
});
