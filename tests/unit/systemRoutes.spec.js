import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

async function startTestApp(router, dashboardUser = { id: 1, role: 'admin', email: 'admin@system' }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.dashboardUser = dashboardUser;
        next();
    });
    app.use('/', router);
    return app;
}

test('System Routes - GET /status returns control center status', async () => {
    const mockStatus = { runners: [], events: [] };
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                getStatus: async () => mockStatus
            }
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

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...mockStatus, currentUser: { id: 1, role: 'admin', email: 'admin@system' } });
});

test('System Routes - GET /health-status returns services health', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/services/metricsStore.js': {
            getServiceErrorSummary: async () => ({ errors: 0 }),
            listServiceChecks: async () => [{ ok: true, responseMs: 100, timestamp: Date.now() }],
            listServiceErrors: async () => [],
            getServiceUptime: async () => ({ uptimePercent: 100 })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/health-status?hours=1');

    expect(response.status).toBe(200);
    expect(response.body.services).toBeDefined();
    expect(response.body.services.length).toBe(3);
    expect(response.body.services[0].label).toBe('GitHub API');
});

test('System Routes - GET /token-names returns names', async () => {
    const mockTokenNames = [{ tokenIndex: 0, customName: 'Main' }];
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/db/database.js': {
            listTokenNames: async () => mockTokenNames
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/token-names');

    expect(response.status).toBe(200);
    expect(response.body.tokenNames).toEqual(mockTokenNames);
});

test('System Routes - PUT /token-names/:tokenIndex updates name', async () => {
    let captured = null;
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/db/database.js': {
            upsertTokenName: async (idx, name) => { captured = { idx, name }; }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app)
        .put('/token-names/1')
        .send({ customName: 'New Name' });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(captured).toEqual({ idx: 1, name: 'New Name' });
});

test('System Routes - POST /runners/:runnerId/stop stops a runner', async () => {
    let stoppedId = null;
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runners: new Map([['r1', { details: { agentName: 'Test' } }]]),
                getRunnerSnapshot: () => ({ id: 'r1' }),
                stopRunner: async (id) => { stoppedId = id; return true; }
            }
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

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).post('/runners/r1/stop');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(stoppedId).toBe('r1');
});

test('System Routes - GET /runners/:runnerId/session returns session info', async () => {
    const mockRunner = { details: { agentName: 'TestAgent' } };
    const mockSession = { id: 's1', status: 'COMPLETED' };
    const mockActivities = { activities: [] };

    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runners: new Map([['r1', mockRunner]]),
                getRunnerSnapshot: () => ({ sessionId: 's1' })
            }
        },
        '../../src/api/julesClient.js': {
            getSession: async () => mockSession,
            listActivities: async () => mockActivities
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/runners/r1/session');

    expect(response.status).toBe(200);
    expect(response.body.session).toEqual(mockSession);
    expect(response.body.activities).toEqual(mockActivities.activities);
});
