import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

const setupRouter = async (mocks = {}) => {
    return await esmock('../../src/routes/agentRoutes.js', {
        '../../src/db/database.js': {
            listAgents: vi.fn(async () => [{ id: 1, name: 'Agent 1' }]),
            getAgent: vi.fn(async (id) => id === '1' ? { id: '1', name: 'Agent 1' } : null),
            createAgent: vi.fn(async () => true),
            updateAgent: vi.fn(async () => true),
            deleteAgent: vi.fn(async () => true),
            reorderAgents: vi.fn(async () => true),
            ...mocks.database
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                runAgentOnce: vi.fn(async () => 'runner-123'),
                ...mocks.controlCenter
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn(async () => {}),
            ...mocks.authMiddleware
        }
    });
};

const createApp = (router) => {
    const app = express();
    app.use(express.json());
    app.use('/agents', router);
    return app;
};

test('Agent Routes - GET / returns list of agents', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/agents');
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
});

test('Agent Routes - POST / creates an agent', async () => {
    const createSpy = vi.fn(async () => true);
    const router = await setupRouter({ database: { createAgent: createSpy } });
    const app = createApp(router);

    const res = await request(app)
        .post('/agents')
        .send({ name: 'New', prompt: 'test' });

    expect(res.status).toBe(201);
    expect(createSpy).toHaveBeenCalled();
});

test('Agent Routes - GET /:id returns agent', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/agents/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');

    const res404 = await request(app).get('/agents/999');
    expect(res404.status).toBe(404);
});

test('Agent Routes - PUT /:id updates agent', async () => {
    const updateSpy = vi.fn(async () => true);
    const router = await setupRouter({ database: { updateAgent: updateSpy } });
    const app = createApp(router);

    const res = await request(app)
        .put('/agents/1')
        .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'Updated' }));
});

test('Agent Routes - DELETE /:id deletes agent', async () => {
    const deleteSpy = vi.fn(async () => true);
    const router = await setupRouter({ database: { deleteAgent: deleteSpy } });
    const app = createApp(router);

    const res = await request(app).delete('/agents/1');
    expect(res.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalledWith('1');
});

test('Agent Routes - POST /reorder reorders agents', async () => {
    const reorderSpy = vi.fn(async () => true);
    const router = await setupRouter({ database: { reorderAgents: reorderSpy } });
    const app = createApp(router);

    const res = await request(app)
        .post('/agents/reorder')
        .send({ ids: [1, 2, 3] });

    expect(res.status).toBe(200);
    expect(reorderSpy).toHaveBeenCalledWith([1, 2, 3]);
});

test('Agent Routes - POST /run-once triggers execution', async () => {
    const runSpy = vi.fn(async () => 'r-123');
    const router = await setupRouter({ controlCenter: { runAgentOnce: runSpy } });
    const app = createApp(router);

    const res = await request(app)
        .post('/agents/run-once/p1/1')
        .send({ instructions: 'go' });

    expect(res.status).toBe(202);
    expect(res.body.runnerId).toBe('r-123');
    expect(runSpy).toHaveBeenCalledWith('p1', 1, expect.objectContaining({ instructions: 'go' }));
});
