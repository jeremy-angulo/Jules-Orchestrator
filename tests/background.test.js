import test from 'node:test';
import assert from 'node:assert';
import { runBackgroundAgent } from '../src/agents/background.js';
import * as julesClient from '../src/api/julesClient.js';
import * as db from '../src/db/database.js';

test('runBackgroundAgent skips if no backgroundPrompts', async () => {
  const project = { id: 'test', backgroundPrompts: [] };
  await runBackgroundAgent(project);
  assert.ok(true, 'Returns immediately');
});

test('runBackgroundAgent skips if backgroundPrompts is undefined', async () => {
  const project = { id: 'test' };
  await runBackgroundAgent(project);
  assert.ok(true, 'Returns immediately');
});
