import { test, expect, vi, afterEach } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

afterEach(() => {
    vi.restoreAllMocks();
});

async function startTestApp(router, setupCustomMiddleware = null) {
    const app = express();
    app.use(express.json());
    if (setupCustomMiddleware) {
        setupCustomMiddleware(app);
    } else {
        // Default middleware configuration
        app.use((req, res, next) => {
            req.dashboardSessionToken = 'test-token';
            next();
        });
    }
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

    const app = await startTestApp(authRoutes.default, (expressApp) => {
        expressApp.use((req, res, next) => {
            req.dashboardUser = mockUser;
            next();
        });
    });

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

test('Auth Routes - consecutive failed login attempts correctly increment attempt counter', async () => {
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            authenticateDashboardUser: async () => null
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const email = 'tracker@example.com';

    // First failed login
    const r1 = await request(app)
        .post('/login')
        .send({ email, password: 'pw' });
    expect(r1.status).toBe(401);
    expect(r1.body.error).toBe('Invalid credentials.');

    // Second failed login
    const r2 = await request(app)
        .post('/login')
        .send({ email, password: 'pw' });
    expect(r2.status).toBe(401);
    expect(r2.body.error).toBe('Invalid credentials.');
});

test('Auth Routes - /login locks out user with 429 after LOGIN_MAX_ATTEMPTS reached', async () => {
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            authenticateDashboardUser: async () => null
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const email = 'lockout@example.com';

    // Send 5 failed attempts (LOGIN_MAX_ATTEMPTS)
    for (let i = 0; i < 5; i++) {
        const res = await request(app)
            .post('/login')
            .send({ email, password: 'pw' });
        expect(res.status).toBe(401);
    }

    // Next request should return 429
    const res = await request(app)
        .post('/login')
        .send({ email, password: 'pw' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many failed login attempts. Account temporarily locked.');
});

test('Auth Routes - lockout is lifted after timeout passes', async () => {
    let now = 1000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const mockUser = { id: 1, email: 'timeout@example.com', role: 'admin' };
    const authRoutes = await esmock('../../src/routes/authRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            authenticateDashboardUser: async (email, password) => {
                if (password === 'correct') return mockUser;
                return null;
            },
            createDashboardSession: async () => ({ token: 'new-token', expiresAt: now + 10000 })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = await startTestApp(authRoutes.default);
    const email = 'timeout@example.com';

    // Lock the account by exhausting attempts
    for (let i = 0; i < 5; i++) {
        const res = await request(app)
            .post('/login')
            .send({ email, password: 'pw' });
        expect(res.status).toBe(401);
    }

    // Ensure 429 is received
    const rLocked = await request(app)
        .post('/login')
        .send({ email, password: 'pw' });
    expect(rLocked.status).toBe(429);

    // Fast-forward 15 minutes + 1ms (15 * 60 * 1000 = 900000)
    now += 900001;

    // Login with correct credentials should now succeed and lift the lock
    const rSuccess = await request(app)
        .post('/login')
        .send({ email, password: 'correct' });
    expect(rSuccess.status).toBe(200);
    expect(rSuccess.body.ok).toBe(true);
    expect(rSuccess.body.user).toEqual(mockUser);
});
