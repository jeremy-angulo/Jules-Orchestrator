import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import express from 'express';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/', router);
    const server = app.listen(0);
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
    };
}

test('Agent Routes - GET / returns list of agents', async (t) => {
    const mockAgents = [{ id: 1, name: 'Agent 1' }];
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            listAgents: async () => mockAgents
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.agents, mockAgents);
    } finally {
        close();
    }
});

test('Agent Routes - POST / creates an agent', async (t) => {
    let created = null;
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            createAgent: async (agent) => { created = agent; },
            listAgents: async () => [{ id: 1, name: 'New Agent' }]
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'New Agent', prompt: 'test prompt' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 201);
        assert.strictEqual(created.name, 'New Agent');
        assert.strictEqual(data.agent.id, 1);
    } finally {
        close();
    }
});

test('Agent Routes - GET /:id returns agent', async (t) => {
    const mockAgent = { id: 1, name: 'Agent 1' };
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            getAgent: async (id) => id === '1' ? mockAgent : null
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/1');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data, mockAgent);

        const failRes = await fetch(url + '/2');
        assert.strictEqual(failRes.status, 404);
    } finally {
        close();
    }
});

test('Agent Routes - PUT /:id updates agent', async (t) => {
    let updated = null;
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            updateAgent: async (id, data) => { updated = { id, ...data }; },
            getAgent: async (id) => ({ id, name: 'Updated Name' })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/1', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Updated Name' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(updated.id, '1');
        assert.strictEqual(data.agent.name, 'Updated Name');
    } finally {
        close();
    }
});

test('Agent Routes - DELETE /:id deletes agent', async (t) => {
    let deletedId = null;
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            getAgent: async (id) => id === '1' ? { id: '1', name: 'To Delete' } : null,
            deleteAgent: async (id) => { deletedId = id; }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/1', { method: 'DELETE' });
        assert.strictEqual(response.status, 200);
        assert.strictEqual(deletedId, '1');
    } finally {
        close();
    }
});

test('Agent Routes - POST /reorder reorders agents', async (t) => {
    let reorderedIds = null;
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            reorderAgents: async (ids) => { reorderedIds = ids; }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [3, 1, 2] })
        });
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(reorderedIds, [3, 1, 2]);
    } finally {
        close();
    }
});

test('Agent Routes - POST /run-once triggers execution', async (t) => {
    let runOnceCalled = false;
    const agentRoutes = await esmock('../../src/routes/agentRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runAgentOnce: async (projId, agentId, opts) => {
                    runOnceCalled = true;
                    return 'runner-123';
                }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(agentRoutes);
    try {
        const response = await fetch(url + '/run-once/project-1/1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instructions: 'do something' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 202);
        assert.strictEqual(runOnceCalled, true);
        assert.strictEqual(data.runnerId, 'runner-123');
    } finally {
        close();
    }
});
