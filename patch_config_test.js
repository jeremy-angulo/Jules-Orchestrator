import fs from 'fs';

let content = `
import test from 'node:test';
import assert from 'node:assert';
import { GLOBAL_CONFIG, PROJECTS } from '../src/config.js';

GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];

test('config exports GLOBAL_CONFIG and PROJECTS', () => {
  assert.ok(GLOBAL_CONFIG, 'GLOBAL_CONFIG should exist');
  assert.ok(PROJECTS, 'PROJECTS should exist');
  assert.ok(Array.isArray(PROJECTS), 'PROJECTS should be an array');
});
`;

fs.writeFileSync('tests/config.test.js', content);
console.log('patched config.test.js');
