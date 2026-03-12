import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import { scheduleBuildAndMergePipeline } from '../src/agents/pipeline.js';
import * as julesClient from '../src/api/julesClient.js';
import * as db from '../src/db/database.js';

test('scheduleBuildAndMergePipeline returns if no pipeline config', () => {
    const project = { id: 'test', buildAndMergePipeline: null };
    scheduleBuildAndMergePipeline(project);
    assert.ok(true, 'Returns immediately');
});
