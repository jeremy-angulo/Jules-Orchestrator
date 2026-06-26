import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    // Mock middleware
    app.use((req, res, next) => {
        req.dashboardSessionToken = 'test-token';
        next();
    });
    app.use('/', router);
    return app;
}

test('Auth Routes - /login handles successful login', async () => {
    const mockUser = { id: 1, email: 'test@example.com', role: 'admin' };
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            authenticateDashboardUser: async () => mockUser,
            createDashboardSession: async () => ({ token: 'new-token', expiresAt: Date.now() + 10000 })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'password' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.user).toEqual(mockUser);
    expect(response.headers['set-cookie']).toBeDefined();
});

test('Auth Routes - /login handles invalid credentials', async () => {
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            authenticateDashboardUser: async () => null
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid credentials.');
});

test('Auth Routes - /me returns authenticated user', async () => {
    const mockUser = { id: 1, email: 'test@example.com', role: 'admin' };
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            hasAnyDashboardUser: async () => true
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.dashboardUser = mockUser;
        next();
    });
    app.use('/', authRoutes.default);

    const response = await request(app).get('/me');

    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.user).toEqual(mockUser);
});

test('Auth Routes - /logout clears cookie', async () => {
    let deletedToken = null;
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            deleteDashboardSession: async (token) => { deletedToken = token; }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const response = await request(app).post('/logout');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(deletedToken).toBe('test-token');
    // Check if cookie is cleared (expires in the past)
    expect(response.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
});

test('Auth Routes - /bootstrap-admin creates first admin', async () => {
    const mockUser = { id: 1, email: 'admin@example.com', role: 'admin' };
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            hasAnyDashboardUser: async () => false,
            createDashboardUser: async () => mockUser,
            createDashboardSession: async () => ({ token: 'bootstrap-token', expiresAt: Date.now() + 10000 })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const response = await request(app)
        .post('/bootstrap-admin')
        .send({ email: 'admin@example.com', password: 'password' });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.user).toEqual(mockUser);
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'][0]).toContain('orchestrator_session=bootstrap-token');
});

test('Auth Routes - /bootstrap-admin returns 409 if already setup', async () => {
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            hasAnyDashboardUser: async () => true
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const response = await request(app)
        .post('/bootstrap-admin')
        .send({ email: 'admin@example.com', password: 'password' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Setup already completed.');
});

test('Auth Routes - /bootstrap-admin returns 400 on error', async () => {
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            hasAnyDashboardUser: async () => false,
            createDashboardUser: async () => { throw new Error('Invalid email.'); }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const response = await request(app)
        .post('/bootstrap-admin')
        .send({ email: 'invalid', password: 'pw' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid email.');
});
