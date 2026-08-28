import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

const setupRouter = async (mocks = {}) => {
    return await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            listAssignments: vi.fn(async () => [{ id: 1, project_id: 'p1', agent_id: 'a1', enabled: 1 }]),
            createAssignment: vi.fn(async () => 123),
            getAssignment: vi.fn(async (id) => ({ id, project_id: 'p1', agent_id: 'a1', enabled: 1 })),
            toggleAssignment: vi.fn(async () => {}),
            updateAssignment: vi.fn(async () => {}),
            deleteAssignment: vi.fn(async () => {}),
            listJournalByAssignment: vi.fn(async () => [{ id: 1, assignment_id: 123, status: 'success' }]),
            ...mocks.database
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: vi.fn((id) => id === 1),
                _invalidateAssignmentsCache: vi.fn(() => {}),
                startAssignment: vi.fn(async () => {}),
                stopAssignment: vi.fn(async () => {}),
                runAssignmentOnce: vi.fn(async () => 'runner-123'),
                ...mocks.controlCenter
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn(async () => {})
        }
    });
};

const createApp = (router) => {
    const app = express();
    app.use(express.json());
    app.use('/assignments', router);
    return app;
};

test('Assignment Routes - GET / returns assignments', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/assignments');
    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0].running).toBe(true);
});

test('Assignment Routes - GET / handles service error with 500', async () => {
    const router = await setupRouter({
        database: { listAssignments: vi.fn(async () => { throw new Error('DB Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app).get('/assignments');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB Error');
});

test('Assignment Routes - POST / creates and starts an assignment', async () => {
    const startSpy = vi.fn(async () => {});
    const router = await setupRouter({
        controlCenter: { startAssignment: startSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/assignments')
        .send({ project_id: 'p1', agent_id: 'a1' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.assignment.id).toBe(123);
    expect(startSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - POST / throws error if newly created assignment not found', async () => {
    const router = await setupRouter({
        database: { getAssignment: vi.fn(async () => null) }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/assignments')
        .send({ project_id: 'p1', agent_id: 'a1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to retrieve newly created assignment');
});

test('Assignment Routes - POST / handles service error with 500', async () => {
    const router = await setupRouter({
        database: { createAssignment: vi.fn(async () => { throw new Error('Create Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/assignments')
        .send({ project_id: 'p1', agent_id: 'a1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Create Error');
});

test('Assignment Routes - POST /:id/toggle toggles off and stops assignment', async () => {
    const stopSpy = vi.fn(async () => {});
    const router = await setupRouter({
        database: {
            getAssignment: vi.fn(async (id) => ({ id, enabled: 1 }))
        },
        controlCenter: { stopAssignment: stopSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/123/toggle');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(stopSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - POST /:id/toggle returns 404 when assignment missing', async () => {
    const router = await setupRouter({
        database: { getAssignment: vi.fn(async () => null) }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/999/toggle');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Assignment not found.');
});

test('Assignment Routes - POST /:id/toggle handles error with 500', async () => {
    const router = await setupRouter({
        database: { getAssignment: vi.fn(async () => { throw new Error('Toggle Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/123/toggle');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Toggle Error');
});

test('Assignment Routes - POST /:id/run triggers one-off execution', async () => {
    const runOnceSpy = vi.fn(async () => 'runner-456');
    const router = await setupRouter({
        controlCenter: { runAssignmentOnce: runOnceSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/123/run');
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.runnerId).toBe('runner-456');
    expect(runOnceSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - POST /:id/run handles service error with 500', async () => {
    const router = await setupRouter({
        controlCenter: { runAssignmentOnce: vi.fn(async () => { throw new Error('Run Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/123/run');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Run Error');
});

test('Assignment Routes - POST /:id/stop stops assignment', async () => {
    const stopSpy = vi.fn(async () => {});
    const router = await setupRouter({
        controlCenter: { stopAssignment: stopSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/123/stop');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(stopSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - POST /:id/stop handles service error with 500', async () => {
    const router = await setupRouter({
        controlCenter: { stopAssignment: vi.fn(async () => { throw new Error('Stop Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app).post('/assignments/123/stop');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Stop Error');
});

test('Assignment Routes - PUT /:id updates and restarts enabled assignment', async () => {
    const stopSpy = vi.fn(async () => {});
    const startSpy = vi.fn(async () => {});
    const router = await setupRouter({
        database: {
            getAssignment: vi.fn(async (id) => ({ id, enabled: 1 }))
        },
        controlCenter: { stopAssignment: stopSpy, startAssignment: startSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .put('/assignments/123')
        .send({ agent_id: 'a2', mode: 'loop' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(stopSpy).toHaveBeenCalledWith(123);
    expect(startSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - PUT /:id updates and stops disabled assignment', async () => {
    const stopSpy = vi.fn(async () => {});
    const router = await setupRouter({
        database: {
            getAssignment: vi.fn(async (id) => ({ id, enabled: 0 }))
        },
        controlCenter: { stopAssignment: stopSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .put('/assignments/123')
        .send({ enabled: 0 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(stopSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - PUT /:id returns 404 when assignment missing', async () => {
    const router = await setupRouter({
        database: { getAssignment: vi.fn(async () => null) }
    });
    const app = createApp(router);

    const res = await request(app)
        .put('/assignments/999')
        .send({ mode: 'loop' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Assignment not found.');
});

test('Assignment Routes - PUT /:id handles service error with 500', async () => {
    const router = await setupRouter({
        database: { getAssignment: vi.fn(async () => { throw new Error('Update Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app)
        .put('/assignments/123')
        .send({ mode: 'loop' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Update Error');
});

test('Assignment Routes - GET /:id/journal returns journal entries', async () => {
    const journalSpy = vi.fn(async (id, limit) => [{ id: 10, assignment_id: id }]);
    const router = await setupRouter({
        database: { listJournalByAssignment: journalSpy }
    });
    const app = createApp(router);

    const res = await request(app).get('/assignments/123/journal?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.journal).toHaveLength(1);
    expect(journalSpy).toHaveBeenCalledWith(123, 10);
});

test('Assignment Routes - GET /:id/journal handles service error with 500', async () => {
    const router = await setupRouter({
        database: { listJournalByAssignment: vi.fn(async () => { throw new Error('Journal Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app).get('/assignments/123/journal');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Journal Error');
});

test('Assignment Routes - DELETE /:id stops and deletes assignment', async () => {
    const stopSpy = vi.fn(async () => {});
    const deleteSpy = vi.fn(async () => {});
    const router = await setupRouter({
        database: { deleteAssignment: deleteSpy },
        controlCenter: { stopAssignment: stopSpy }
    });
    const app = createApp(router);

    const res = await request(app).delete('/assignments/123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(stopSpy).toHaveBeenCalledWith(123);
    expect(deleteSpy).toHaveBeenCalledWith(123);
});

test('Assignment Routes - DELETE /:id handles service error with 500', async () => {
    const router = await setupRouter({
        database: { deleteAssignment: vi.fn(async () => { throw new Error('Delete Error'); }) }
    });
    const app = createApp(router);

    const res = await request(app).delete('/assignments/123');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Delete Error');
});
