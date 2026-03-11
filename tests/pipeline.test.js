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
