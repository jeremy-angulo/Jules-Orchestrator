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

// New tests targeting identified untested logic/endpoints:

test('System Routes - POST /start starts all schedulers', async () => {
    let startAllCalled = false;
    let auditCalledWith = null;

    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                startAll: async () => { startAllCalled = true; }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async (req, action, target) => { auditCalledWith = { action, target }; }
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).post('/start');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(startAllCalled).toBe(true);
    expect(auditCalledWith).toEqual({ action: 'system.start', target: 'all' });
});

test('System Routes - POST /stop stops all schedulers', async () => {
    let stopAllCalled = false;
    let auditCalledWith = null;

    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                stopAll: async () => { stopAllCalled = true; }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async (req, action, target) => { auditCalledWith = { action, target }; }
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).post('/stop');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(stopAllCalled).toBe(true);
    expect(auditCalledWith).toEqual({ action: 'system.stop', target: 'all' });
});

test('System Routes - GET /logs returns system events', async () => {
    const mockEvents = [{ at: Date.now(), level: 'info', message: 'Hello' }];
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                getStatus: async () => ({ events: mockEvents })
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/logs');

    expect(response.status).toBe(200);
    expect(response.body.logs).toEqual(mockEvents);
});

test('System Routes - GET /audit-events lists audit logs', async () => {
    const mockEvents = [{ id: 1, action: 'test' }];
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/db/database.js': {
            listAuditEvents: async (hours, limit) => {
                expect(hours).toBe(48);
                expect(limit).toBe(50);
                return mockEvents;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/audit-events?hours=48&limit=50');

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual(mockEvents);
});

test('System Routes - GET /analytics/metrics lists metrics', async () => {
    const mockSeries = { active_runners: [] };
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/services/metricsStore.js': {
            listDashboardMetricsBatch: async (keys, hours) => {
                expect(keys).toEqual(['active_runners', 'active_tasks', 'locked_projects']);
                expect(hours).toBe(12);
                return mockSeries;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/analytics/metrics?hours=12');

    expect(response.status).toBe(200);
    expect(response.body.hours).toBe(12);
    expect(response.body.series).toEqual(mockSeries);
});

test('System Routes - PUT /token-names/:tokenIndex returns 400 when customName is missing', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app)
        .put('/token-names/1')
        .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Custom name required');
});

test('System Routes - GET /keys returns key summary status', async () => {
    const mockSummary = { keys: [] };
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/api/tokenRotation.js': {
            getTokenStatusSummary: async () => mockSummary
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/keys');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSummary);
});

test('System Routes - GET /health-status handles errors with 500', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/services/metricsStore.js': {
            getServiceErrorSummary: async () => { throw new Error('Metrics Fail'); }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/health-status');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Metrics Fail');
});

test('System Routes - GET /keys handles errors with 500', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/api/tokenRotation.js': {
            getTokenStatusSummary: async () => { throw new Error('Keys Fail'); }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/keys');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Keys Fail');
});

test('System Routes - GET /token-names handles errors with 500', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/db/database.js': {
            listTokenNames: async () => { throw new Error('Token Names Fail'); }
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

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Token Names Fail');
});

// Additional Coverage Tests

test('System Routes - GET /runners/:runnerId/session runner not found', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runners: new Map(),
                getRunnerSnapshot: () => { throw new Error('Should not be called'); }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/runners/unknown-runner/session');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Runner not found.');
});

test('System Routes - GET /runners/:runnerId/session when sessionId is missing', async () => {
    const mockRunner = { details: { agentName: 'TestAgent' } };
    const snapshot = { id: 'r1', sessionId: null };
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runners: new Map([['r1', mockRunner]]),
                getRunnerSnapshot: () => snapshot
            }
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
    expect(response.body.runner).toEqual(snapshot);
    expect(response.body.session).toBeNull();
    expect(response.body.activities).toEqual([]);
});

test('System Routes - GET /runners/:runnerId/session handling getSession / listActivities errors gracefully', async () => {
    const mockRunner = { details: { agentName: 'TestAgent' } };
    const snapshot = { id: 'r1', sessionId: 's1' };
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runners: new Map([['r1', mockRunner]]),
                getRunnerSnapshot: () => snapshot
            }
        },
        '../../src/api/julesClient.js': {
            getSession: async () => { throw new Error('Client getSession error'); },
            listActivities: async () => { throw new Error('Client listActivities error'); }
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

    // It catches errors and still returns a 200 with runner details, but session/activities are null/empty, or returns the error message
    expect(response.status).toBe(200);
    expect(response.body.runner).toEqual(snapshot);
});

test('System Routes - POST /runners/:runnerId/stop returns 404 when runner not found', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                stopRunner: async () => false
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).post('/runners/unknown/stop');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Runner not found.');
});

test('System Routes - POST /start returns 500 on startAll error', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                startAll: async () => { throw new Error('Failed to start control center'); }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).post('/start');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to start control center');
});

test('System Routes - POST /stop returns 500 on stopAll error', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                stopAll: async () => { throw new Error('Failed to stop control center'); }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).post('/stop');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to stop control center');
});

test('System Routes - GET /status returns 500 on getStatus error', async () => {
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                getStatus: async () => { throw new Error('Failed to get status'); }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const app = await startTestApp(systemRoutes.default);
    const response = await request(app).get('/status');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to get status');
});

test('System Routes - GET /health-status serves cached response if cached within threshold', async () => {
    let callCount = 0;
    const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
        '../../src/services/metricsStore.js': {
            getServiceErrorSummary: async () => {
                callCount++;
                return { errors: 0 };
            },
            listServiceChecks: async () => [{ ok: true, responseMs: 50, timestamp: Date.now() }],
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
    const response1 = await request(app).get('/health-status?hours=1');
    const response2 = await request(app).get('/health-status?hours=1');

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    // Since each `await esmock(...)` imports its own fresh isolated module instance with reset top-level variables,
    // we need to call the SAME app instance router to hit the cache of the same module instance!
    // Our test is indeed doing this (app.get twice on the same app).
    // Let's check why callCount is 3. Ah! It's because there are 3 buildService calls inside GET /health-status!
    // Each service buildService('github_api'), buildService('jules_api'), buildService('website') triggers getServiceErrorSummary!
    // So the first request calls it 3 times (callCount becomes 3).
    // The second request uses the cache, so it doesn't call getServiceErrorSummary again.
    // Therefore, callCount remains 3!
    expect(callCount).toBe(3);
});
