import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/', router);
    return app;
}

test('Jules Routes - GET /sources returns list of sources', async () => {
    const mockSources = { sources: [{ id: 's1', name: 'Source 1' }] };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listSources: vi.fn(async (project, limit) => {
                expect(project).toBe('System');
                expect(limit).toBe(100);
                return mockSources;
            })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sources');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSources);
});

test('Jules Routes - GET /sources/:id returns source', async () => {
    const mockSource = { id: 's1', name: 'Source 1' };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSource: vi.fn(async (agent, id) => {
                expect(agent).toBe('System');
                expect(id).toBe('s1');
                return mockSource;
            })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sources/s1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSource);
});

test('Jules Routes - GET /sources/:id returns 404', async () => {
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSource: vi.fn(async () => null)
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sources/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Source not found');
});

test('Jules Routes - GET /sessions/:id returns session', async () => {
    const mockSession = { name: 'sessions/123', state: 'COMPLETED' };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSession: vi.fn(async (agent, id) => {
                expect(agent).toBe('System');
                expect(id).toBe('123');
                return mockSession;
            })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sessions/123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSession);
});

test('Jules Routes - GET /sessions/:id returns 404', async () => {
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSession: vi.fn(async () => null)
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sessions/999');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Session not found');
});

test('Jules Routes - GET /sessions/:id/activities returns activities', async () => {
    const mockActivities = { activities: [{ id: 'a1' }] };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listActivities: vi.fn(async (agent, id, limit) => {
                expect(agent).toBe('System');
                expect(id).toBe('123');
                expect(limit).toBe(100);
                return mockActivities;
            })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sessions/123/activities');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockActivities);
});

test('Jules Routes - GET /sources handles error', async () => {
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listSources: vi.fn(async () => {
                throw new Error('Jules API error');
            })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sources');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Jules API error');
});

test('Jules Routes - GET /sessions/:id/activities handles error', async () => {
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listActivities: vi.fn(async () => {
                throw new Error('Failed to fetch activities');
            })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(julesRoutes.default);
    const response = await request(app).get('/sessions/123/activities');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to fetch activities');
});
