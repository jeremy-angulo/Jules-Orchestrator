import { test, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

// We need to manage mock implementations dynamically for test assertions.
let mockRunnersMap = new Map();
let mockGetRunnerSnapshot = vi.fn();
let mockStopRunner = vi.fn();
let mockStartAll = vi.fn();
let mockStopAll = vi.fn();
let mockGetStatus = vi.fn();

let mockListAuditEvents = vi.fn();
let mockListTokenNames = vi.fn();
let mockUpsertTokenName = vi.fn();

let mockListDashboardMetricsBatch = vi.fn();
let mockGetServiceErrorSummary = vi.fn();
let mockListServiceChecks = vi.fn();
let mockListServiceErrors = vi.fn();
let mockGetServiceUptime = vi.fn();
let mockRecordServiceCheck = vi.fn();

let mockGetTokenStatusSummary = vi.fn();
let mockGetSession = vi.fn();
let mockListActivities = vi.fn();
let mockAudit = vi.fn();

beforeEach(() => {
    vi.resetAllMocks();
    mockRunnersMap.clear();

    // Default return values
    mockGetRunnerSnapshot.mockImplementation((runner) => ({
        id: runner.id,
        sessionId: runner.sessionId,
        status: runner.status,
    }));
    mockStopRunner.mockResolvedValue(true);
    mockStartAll.mockResolvedValue();
    mockStopAll.mockResolvedValue();
    mockGetStatus.mockResolvedValue({
        startedAt: '2023-01-01T00:00:00.000Z',
        events: [{ id: 1, message: 'system up' }],
    });

    mockListAuditEvents.mockResolvedValue([{ id: 1, action: 'test' }]);
    mockListTokenNames.mockResolvedValue(['Token A', 'Token B']);
    mockUpsertTokenName.mockResolvedValue(true);

    mockListDashboardMetricsBatch.mockResolvedValue([{ metric: 'active_runners', data: [] }]);
    mockGetServiceErrorSummary.mockResolvedValue({ errors: 0 });
    mockListServiceChecks.mockResolvedValue([{ responseMs: 120, timestamp: Date.now(), ok: true }]);
    mockListServiceErrors.mockResolvedValue([]);
    mockGetServiceUptime.mockResolvedValue({ uptimePercent: 100 });
    mockRecordServiceCheck.mockResolvedValue();

    mockGetTokenStatusSummary.mockResolvedValue({ configured: true, status: 'ok' });
    mockGetSession.mockResolvedValue({ id: 'session-123', state: 'RUNNING' });
    mockListActivities.mockResolvedValue({ activities: [{ type: 'step' }] });
    mockAudit.mockResolvedValue();
});

const setupRouter = async () => {
    return await esmock('../../src/routes/systemRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runners: mockRunnersMap,
                getRunnerSnapshot: mockGetRunnerSnapshot,
                stopRunner: mockStopRunner,
                startAll: mockStartAll,
                stopAll: mockStopAll,
                getStatus: mockGetStatus,
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next(),
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: (perm) => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: mockAudit,
        },
        '../../src/db/database.js': {
            listAuditEvents: mockListAuditEvents,
            listTokenNames: mockListTokenNames,
            upsertTokenName: mockUpsertTokenName,
        },
        '../../src/services/metricsStore.js': {
            listDashboardMetricsBatch: mockListDashboardMetricsBatch,
            getServiceErrorSummary: mockGetServiceErrorSummary,
            listServiceChecks: mockListServiceChecks,
            listServiceErrors: mockListServiceErrors,
            getServiceUptime: mockGetServiceUptime,
            recordServiceCheck: mockRecordServiceCheck,
        },
        '../../src/api/tokenRotation.js': {
            getTokenStatusSummary: mockGetTokenStatusSummary,
        },
        '../../src/api/julesClient.js': {
            getSession: mockGetSession,
            listActivities: mockListActivities,
        }
    });
};

const createApp = (router) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.dashboardUser = { id: 'admin-user', role: 'admin' };
        next();
    });
    app.use('/system', router);
    return app;
};

test('System Routes - GET /runners/:runnerId/session - 404 if runner not found', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/runners/invalid-runner/session');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Runner not found.');
});

test('System Routes - GET /runners/:runnerId/session - 200 with null session if no sessionId', async () => {
    mockRunnersMap.set('runner-no-session', { id: 'runner-no-session' });
    mockGetRunnerSnapshot.mockReturnValueOnce({ id: 'runner-no-session', sessionId: null });

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/runners/runner-no-session/session');
    expect(res.status).toBe(200);
    expect(res.body.runner.id).toBe('runner-no-session');
    expect(res.body.session).toBeNull();
    expect(res.body.activities).toEqual([]);
});

test('System Routes - GET /runners/:runnerId/session - 200 with session and activities if sessionId present', async () => {
    mockRunnersMap.set('runner-with-session', {
        id: 'runner-with-session',
        sessionId: 'session-abc',
        details: { agentName: 'Merge Master' }
    });
    mockGetRunnerSnapshot.mockReturnValueOnce({ id: 'runner-with-session', sessionId: 'session-abc' });

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/runners/runner-with-session/session');
    expect(res.status).toBe(200);
    expect(res.body.runner.id).toBe('runner-with-session');
    expect(res.body.session.id).toBe('session-123');
    expect(res.body.activities).toHaveLength(1);
    expect(mockGetSession).toHaveBeenCalledWith('Merge Master', 'session-abc');
    expect(mockListActivities).toHaveBeenCalledWith('Merge Master', 'session-abc', 100);
});

test('System Routes - GET /runners/:runnerId/session - 200 with null session if fetching rejects', async () => {
    mockRunnersMap.set('runner-with-session', {
        id: 'runner-with-session',
        sessionId: 'session-abc',
    });
    mockGetRunnerSnapshot.mockReturnValueOnce({ id: 'runner-with-session', sessionId: 'session-abc' });
    mockGetSession.mockRejectedValueOnce(new Error('Jules API is down'));
    mockListActivities.mockRejectedValueOnce(new Error('Jules API is down'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/runners/runner-with-session/session');
    expect(res.status).toBe(200);
    expect(res.body.runner.id).toBe('runner-with-session');
    expect(res.body.session).toBeNull();
    expect(res.body.activities).toEqual([]);
    expect(res.body.error).toBeUndefined();
});

test('System Routes - GET /runners/:runnerId/session - 200 with error property if processing throws', async () => {
    mockRunnersMap.set('runner-with-session', {
        id: 'runner-with-session',
        sessionId: 'session-abc',
        get details() {
            throw new Error('Details lookup failed');
        }
    });
    mockGetRunnerSnapshot.mockReturnValueOnce({ id: 'runner-with-session', sessionId: 'session-abc' });

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/runners/runner-with-session/session');
    expect(res.status).toBe(200);
    expect(res.body.runner.id).toBe('runner-with-session');
    expect(res.body.session).toBeNull();
    expect(res.body.error).toBe('Details lookup failed');
});

test('System Routes - POST /runners/:runnerId/stop - 404 if runner not found', async () => {
    mockStopRunner.mockResolvedValueOnce(false);

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/system/runners/not-found/stop');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Runner not found.');
});

test('System Routes - POST /runners/:runnerId/stop - 200 and audits if runner stopped', async () => {
    mockStopRunner.mockResolvedValueOnce(true);

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/system/runners/runner-1/stop');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockStopRunner).toHaveBeenCalledWith('runner-1');
    expect(mockAudit).toHaveBeenCalledWith(expect.any(Object), 'runner.stop', 'runner-1');
});

test('System Routes - POST /start - 200 and audits on success', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/system/start');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockStartAll).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.any(Object), 'system.start', 'all');
});

test('System Routes - POST /start - 500 on error', async () => {
    mockStartAll.mockRejectedValueOnce(new Error('DB boot error'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/system/start');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB boot error');
});

test('System Routes - POST /stop - 200 and audits on success', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/system/stop');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockStopAll).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.any(Object), 'system.stop', 'all');
});

test('System Routes - POST /stop - 500 on error', async () => {
    mockStopAll.mockRejectedValueOnce(new Error('Shutdown blocked'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/system/stop');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Shutdown blocked');
});

test('System Routes - GET /status - 200 with currentUser populated', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.startedAt).toBe('2023-01-01T00:00:00.000Z');
    expect(res.body.currentUser).toEqual({ id: 'admin-user', role: 'admin' });
    expect(mockGetStatus).toHaveBeenCalled();
});

test('System Routes - GET /status - 500 on error', async () => {
    mockGetStatus.mockRejectedValueOnce(new Error('Status unavailable'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Status unavailable');
});

test('System Routes - GET /logs - 200 with logs', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/logs');
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual([{ id: 1, message: 'system up' }]);
});

test('System Routes - GET /audit-events - 200 with custom query params', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/audit-events?hours=48&limit=50');
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([{ id: 1, action: 'test' }]);
    expect(mockListAuditEvents).toHaveBeenCalledWith(48, 50);
});

test('System Routes - GET /analytics/metrics - 200 with series', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/analytics/metrics?hours=12');
    expect(res.status).toBe(200);
    expect(res.body.hours).toBe(12);
    expect(res.body.series).toEqual([{ metric: 'active_runners', data: [] }]);
    expect(mockListDashboardMetricsBatch).toHaveBeenCalledWith(
        ['active_runners', 'active_tasks', 'locked_projects'],
        12
    );
});

test('System Routes - GET /keys - 200 with status summary', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/keys');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, status: 'ok' });
});

test('System Routes - GET /keys - 500 on error', async () => {
    mockGetTokenStatusSummary.mockRejectedValueOnce(new Error('Token fetch error'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/keys');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Token fetch error');
});

test('System Routes - GET /token-names - 200 with tokenNames', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/token-names');
    expect(res.status).toBe(200);
    expect(res.body.tokenNames).toEqual(['Token A', 'Token B']);
});

test('System Routes - GET /token-names - 500 on error', async () => {
    mockListTokenNames.mockRejectedValueOnce(new Error('DB read error'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/token-names');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB read error');
});

test('System Routes - PUT /token-names/:tokenIndex - 400 if customName missing', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).put('/system/token-names/1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Custom name required');
});

test('System Routes - PUT /token-names/:tokenIndex - 200 with upsert and audit on success', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app)
        .put('/system/token-names/2')
        .send({ customName: 'New Token Name' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUpsertTokenName).toHaveBeenCalledWith(2, 'New Token Name');
    expect(mockAudit).toHaveBeenCalledWith(
        expect.any(Object),
        'token.rename',
        'token-2',
        { customName: 'New Token Name' }
    );
});

test('System Routes - GET /health-status - 200 and performs cache operations', async () => {
    const spyDate = vi.spyOn(Date, 'now');
    spyDate.mockReturnValue(1000000);

    const router = await setupRouter();
    const app = createApp(router);

    // First call (cache miss)
    const res1 = await request(app).get('/system/health-status?hours=10');
    expect(res1.status).toBe(200);
    expect(res1.body.hours).toBe(10);
    expect(res1.body.services).toHaveLength(3);
    expect(mockGetServiceErrorSummary).toHaveBeenCalledTimes(3);

    // Reset calls count to verify caching
    mockGetServiceErrorSummary.mockClear();

    // Second call (cache hit, same timestamp, same hours)
    const res2 = await request(app).get('/system/health-status?hours=10');
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual(res1.body);
    expect(mockGetServiceErrorSummary).not.toHaveBeenCalled();

    // Third call (cache miss due to time forward by 61 seconds)
    spyDate.mockReturnValue(1000000 + 61000);
    const res3 = await request(app).get('/system/health-status?hours=10');
    expect(res3.status).toBe(200);
    expect(mockGetServiceErrorSummary).toHaveBeenCalledTimes(3);
});

test('System Routes - GET /health-status - 500 on error', async () => {
    mockGetServiceUptime.mockRejectedValueOnce(new Error('Uptime DB error'));

    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/system/health-status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Uptime DB error');
});
