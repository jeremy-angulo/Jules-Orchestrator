import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

const setupRouter = async (mocks = {}) => {
    return await esmock('../../src/routes/userRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            listDashboardUsers: vi.fn(async () => [{ id: 1, email: 'u1@ex.com', role: 'admin' }]),
            createDashboardUser: vi.fn(async (email, pwd, role) => ({ id: 2, email, role })),
            updateDashboardUserRole: vi.fn(async (id, role) => ({ id, role })),
            deleteDashboardUser: vi.fn(async () => true),
            ...mocks.dashboardAuth
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: vi.fn(async () => {}),
            ...mocks.authMiddleware
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });
};

const createApp = (router) => {
    const app = express();
    app.use(express.json());
    app.use('/users', router);
    return app;
};

test('User Routes - GET / returns users', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe('u1@ex.com');
});

test('User Routes - POST / creates a user', async () => {
    const createSpy = vi.fn(async (email, pwd, role) => ({ id: 2, email, role }));
    const router = await setupRouter({
        dashboardAuth: { createDashboardUser: createSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/users')
        .send({ email: 'new@ex.com', password: 'pwd', role: 'editor' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@ex.com');
    expect(createSpy).toHaveBeenCalledWith('new@ex.com', 'pwd', 'editor');
});

test('User Routes - POST / returns 400 if email or password missing', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app)
        .post('/users')
        .send({ email: 'only-email@ex.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
});

test('User Routes - PATCH /:id updates role', async () => {
    const updateSpy = vi.fn(async (id, role) => ({ id, role }));
    const router = await setupRouter({
        dashboardAuth: { updateDashboardUserRole: updateSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .patch('/users/123')
        .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(updateSpy).toHaveBeenCalledWith('123', 'admin');
});

test('User Routes - DELETE /:id deletes user', async () => {
    const deleteSpy = vi.fn(async () => true);
    const router = await setupRouter({
        dashboardAuth: { deleteDashboardUser: deleteSpy }
    });
    const app = createApp(router);

    const res = await request(app).delete('/users/456');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith('456');
});

test('User Routes - handles service errors with 500', async () => {
    const router = await setupRouter({
        dashboardAuth: { listDashboardUsers: vi.fn(async () => { throw new Error('DB Fail'); }) }
    });
    const app = createApp(router);

    const res = await request(app).get('/users');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB Fail');
});
