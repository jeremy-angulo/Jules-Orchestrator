import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import express from 'express';

// Shared mock states that can be mutated in tests
let mockRunnersMap = new Map();
let mockGetRunnerSnapshot = () => ({});
let mockStopRunner = () => Promise.resolve(true);
let mockStartAll = () => Promise.resolve();
let mockStopAll = () => Promise.resolve();
let mockGetStatus = () => Promise.resolve({ startedAt: '2023-01-01T00:00:00.000Z', events: [] });

let mockListAuditEvents = () => Promise.resolve([]);
let mockListTokenNames = () => Promise.resolve([]);
let mockUpsertTokenName = () => Promise.resolve();

let mockListDashboardMetricsBatch = () => Promise.resolve([]);
let mockGetServiceErrorSummary = () => Promise.resolve({ errors: 0 });
let mockListServiceChecks = () => Promise.resolve([]);
let mockListServiceErrors = () => Promise.resolve([]);
let mockGetServiceUptime = () => Promise.resolve({ uptimePercent: 100 });
let mockRecordServiceCheck = () => Promise.resolve();

let mockGetTokenStatusSummary = () => Promise.resolve({});
let mockGetSession = () => Promise.resolve({});
let mockListActivities = () => Promise.resolve({ activities: [] });
let mockAuditCalls = [];
let mockAudit = async (...args) => { mockAuditCalls.push(args); };

function resetMocks() {
    mockRunnersMap.clear();
    mockGetRunnerSnapshot = () => ({});
    mockStopRunner = () => Promise.resolve(true);
    mockStartAll = () => Promise.resolve();
    mockStopAll = () => Promise.resolve();
    mockGetStatus = () => Promise.resolve({ startedAt: '2023-01-01T00:00:00.000Z', events: [] });

    mockListAuditEvents = () => Promise.resolve([]);
    mockListTokenNames = () => Promise.resolve([]);
    mockUpsertTokenName = () => Promise.resolve();

    mockListDashboardMetricsBatch = () => Promise.resolve([]);
    mockGetServiceErrorSummary = () => Promise.resolve({ errors: 0 });
    mockListServiceChecks = () => Promise.resolve([]);
    mockListServiceErrors = () => Promise.resolve([]);
    mockGetServiceUptime = () => Promise.resolve({ uptimePercent: 100 });
    mockRecordServiceCheck = () => Promise.resolve();

    mockGetTokenStatusSummary = () => Promise.resolve({});
    mockGetSession = () => Promise.resolve({});
    mockListActivities = () => Promise.resolve({ activities: [] });
    mockAuditCalls = [];
}

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.dashboardUser = { id: 'admin-user', role: 'admin' };
        next();
    });
    app.use('/', router);
    const server = app.listen(0);
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
    };
}

const systemRoutes = await esmock('../../src/routes/systemRoutes.js', {
    '../../src/controlCenter.js': {
        controlCenter: {
            runners: mockRunnersMap,
            getRunnerSnapshot: (runner) => mockGetRunnerSnapshot(runner),
            stopRunner: (id) => mockStopRunner(id),
            startAll: () => mockStartAll(),
            stopAll: () => mockStopAll(),
            getStatus: () => mockGetStatus(),
        }
    },
    '../../src/middleware/securityMiddleware.js': {
        apiRateLimiter: (req, res, next) => next(),
    },
    '../../src/middleware/authMiddleware.js': {
        requirePermission: () => (req, res, next) => next(),
        requireCriticalConfirmation: (req, res, next) => next(),
        audit: (...args) => mockAudit(...args),
    },
    '../../src/db/database.js': {
        listAuditEvents: (...args) => mockListAuditEvents(...args),
        listTokenNames: (...args) => mockListTokenNames(...args),
        upsertTokenName: (...args) => mockUpsertTokenName(...args),
    },
    '../../src/services/metricsStore.js': {
        listDashboardMetricsBatch: (...args) => mockListDashboardMetricsBatch(...args),
        getServiceErrorSummary: (...args) => mockGetServiceErrorSummary(...args),
        listServiceChecks: (...args) => mockListServiceChecks(...args),
        listServiceErrors: (...args) => mockListServiceErrors(...args),
        getServiceUptime: (...args) => mockGetServiceUptime(...args),
        recordServiceCheck: (...args) => mockRecordServiceCheck(...args),
    },
    '../../src/api/tokenRotation.js': {
        getTokenStatusSummary: (...args) => mockGetTokenStatusSummary(...args),
    },
    '../../src/api/julesClient.js': {
        getSession: (...args) => mockGetSession(...args),
        listActivities: (...args) => mockListActivities(...args),
    }
});

test('System Routes - GET /runners/:runnerId/session - 404 if runner not found', async (t) => {
    resetMocks();
    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/runners/invalid-runner/session`);
        const data = await response.json();
        assert.strictEqual(response.status, 404);
        assert.strictEqual(data.error, 'Runner not found.');
    } finally {
        close();
    }
});

test('System Routes - GET /runners/:runnerId/session - 200 with null session if no sessionId', async (t) => {
    resetMocks();
    mockRunnersMap.set('runner-no-session', { id: 'runner-no-session' });
    mockGetRunnerSnapshot = (runner) => ({
        id: runner.id,
        sessionId: null,
    });

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/runners/runner-no-session/session`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.runner.id, 'runner-no-session');
        assert.strictEqual(data.session, null);
        assert.deepStrictEqual(data.activities, []);
    } finally {
        close();
    }
});

test('System Routes - GET /runners/:runnerId/session - 200 with session and activities if sessionId present', async (t) => {
    resetMocks();
    const mockRunner = {
        id: 'runner-with-session',
        details: { agentName: 'Merge Master' }
    };
    mockRunnersMap.set('runner-with-session', mockRunner);
    mockGetRunnerSnapshot = (runner) => ({
        id: runner.id,
        sessionId: 'session-abc',
    });

    let getSessionCalledWith = null;
    let listActivitiesCalledWith = null;

    mockGetSession = async (agentName, sessionId) => {
        getSessionCalledWith = { agentName, sessionId };
        return { id: 'session-123', state: 'RUNNING' };
    };

    mockListActivities = async (agentName, sessionId, limit) => {
        listActivitiesCalledWith = { agentName, sessionId, limit };
        return { activities: [{ type: 'step' }] };
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/runners/runner-with-session/session`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.runner.id, 'runner-with-session');
        assert.strictEqual(data.session.id, 'session-123');
        assert.strictEqual(data.activities.length, 1);
        assert.deepStrictEqual(getSessionCalledWith, { agentName: 'Merge Master', sessionId: 'session-abc' });
        assert.deepStrictEqual(listActivitiesCalledWith, { agentName: 'Merge Master', sessionId: 'session-abc', limit: 100 });
    } finally {
        close();
    }
});

test('System Routes - GET /runners/:runnerId/session - 200 with null session if fetching rejects', async (t) => {
    resetMocks();
    const mockRunner = {
        id: 'runner-with-session',
        details: { agentName: 'Merge Master' }
    };
    mockRunnersMap.set('runner-with-session', mockRunner);
    mockGetRunnerSnapshot = (runner) => ({
        id: runner.id,
        sessionId: 'session-abc',
    });

    mockGetSession = () => Promise.reject(new Error('Jules API is down'));
    mockListActivities = () => Promise.reject(new Error('Jules API is down'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/runners/runner-with-session/session`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.runner.id, 'runner-with-session');
        assert.strictEqual(data.session, null);
        assert.deepStrictEqual(data.activities, []);
        assert.strictEqual(data.error, undefined);
    } finally {
        close();
    }
});

test('System Routes - POST /runners/:runnerId/stop - 404 if runner not found', async (t) => {
    resetMocks();
    mockStopRunner = () => Promise.resolve(false);

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/runners/not-found/stop`, { method: 'POST' });
        const data = await response.json();
        assert.strictEqual(response.status, 404);
        assert.strictEqual(data.error, 'Runner not found.');
    } finally {
        close();
    }
});

test('System Routes - POST /runners/:runnerId/stop - 200 and audits if runner stopped', async (t) => {
    resetMocks();
    let stopCalledWith = null;
    mockStopRunner = async (id) => {
        stopCalledWith = id;
        return true;
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/runners/runner-1/stop`, { method: 'POST' });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(stopCalledWith, 'runner-1');
        assert.strictEqual(mockAuditCalls.length, 1);
        assert.strictEqual(mockAuditCalls[0][1], 'runner.stop');
        assert.strictEqual(mockAuditCalls[0][2], 'runner-1');
    } finally {
        close();
    }
});

test('System Routes - POST /start - 200 and audits on success', async (t) => {
    resetMocks();
    let startAllCalled = false;
    mockStartAll = async () => {
        startAllCalled = true;
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/start`, { method: 'POST' });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(startAllCalled, true);
        assert.strictEqual(mockAuditCalls.length, 1);
        assert.strictEqual(mockAuditCalls[0][1], 'system.start');
        assert.strictEqual(mockAuditCalls[0][2], 'all');
    } finally {
        close();
    }
});

test('System Routes - POST /start - 500 on error', async (t) => {
    resetMocks();
    mockStartAll = () => Promise.reject(new Error('DB boot error'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/start`, { method: 'POST' });
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'DB boot error');
    } finally {
        close();
    }
});

test('System Routes - POST /stop - 200 and audits on success', async (t) => {
    resetMocks();
    let stopAllCalled = false;
    mockStopAll = async () => {
        stopAllCalled = true;
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/stop`, { method: 'POST' });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(stopAllCalled, true);
        assert.strictEqual(mockAuditCalls.length, 1);
        assert.strictEqual(mockAuditCalls[0][1], 'system.stop');
        assert.strictEqual(mockAuditCalls[0][2], 'all');
    } finally {
        close();
    }
});

test('System Routes - POST /stop - 500 on error', async (t) => {
    resetMocks();
    mockStopAll = () => Promise.reject(new Error('Shutdown blocked'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/stop`, { method: 'POST' });
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Shutdown blocked');
    } finally {
        close();
    }
});

test('System Routes - GET /status - 200 with currentUser populated', async (t) => {
    resetMocks();
    mockGetStatus = () => Promise.resolve({
        startedAt: '2023-01-01T00:00:00.000Z',
        events: [{ id: 1, message: 'system up' }]
    });

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/status`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.startedAt, '2023-01-01T00:00:00.000Z');
        assert.deepStrictEqual(data.currentUser, { id: 'admin-user', role: 'admin' });
    } finally {
        close();
    }
});

test('System Routes - GET /status - 500 on error', async (t) => {
    resetMocks();
    mockGetStatus = () => Promise.reject(new Error('Status unavailable'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/status`);
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Status unavailable');
    } finally {
        close();
    }
});

test('System Routes - GET /logs - 200 with logs', async (t) => {
    resetMocks();
    mockGetStatus = () => Promise.resolve({
        startedAt: '2023-01-01T00:00:00.000Z',
        events: [{ id: 1, message: 'system up' }]
    });

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/logs`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.logs, [{ id: 1, message: 'system up' }]);
    } finally {
        close();
    }
});

test('System Routes - GET /audit-events - 200 with custom query params', async (t) => {
    resetMocks();
    let listAuditCalledWith = null;
    mockListAuditEvents = async (hours, limit) => {
        listAuditCalledWith = { hours, limit };
        return [{ id: 1, action: 'test' }];
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/audit-events?hours=48&limit=50`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.events, [{ id: 1, action: 'test' }]);
        assert.deepStrictEqual(listAuditCalledWith, { hours: 48, limit: 50 });
    } finally {
        close();
    }
});

test('System Routes - GET /analytics/metrics - 200 with series', async (t) => {
    resetMocks();
    let listMetricsCalledWith = null;
    mockListDashboardMetricsBatch = async (names, hours) => {
        listMetricsCalledWith = { names, hours };
        return [{ metric: 'active_runners', data: [] }];
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/analytics/metrics?hours=12`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.hours, 12);
        assert.deepStrictEqual(data.series, [{ metric: 'active_runners', data: [] }]);
        assert.deepStrictEqual(listMetricsCalledWith, {
            names: ['active_runners', 'active_tasks', 'locked_projects'],
            hours: 12
        });
    } finally {
        close();
    }
});

test('System Routes - GET /keys - 200 with status summary', async (t) => {
    resetMocks();
    mockGetTokenStatusSummary = async () => ({ configured: true, status: 'ok' });

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/keys`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data, { configured: true, status: 'ok' });
    } finally {
        close();
    }
});

test('System Routes - GET /keys - 500 on error', async (t) => {
    resetMocks();
    mockGetTokenStatusSummary = () => Promise.reject(new Error('Token fetch error'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/keys`);
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Token fetch error');
    } finally {
        close();
    }
});

test('System Routes - GET /token-names - 200 with tokenNames', async (t) => {
    resetMocks();
    mockListTokenNames = async () => ['Token A', 'Token B'];

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/token-names`);
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.tokenNames, ['Token A', 'Token B']);
    } finally {
        close();
    }
});

test('System Routes - GET /token-names - 500 on error', async (t) => {
    resetMocks();
    mockListTokenNames = () => Promise.reject(new Error('DB read error'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/token-names`);
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'DB read error');
    } finally {
        close();
    }
});

test('System Routes - PUT /token-names/:tokenIndex - 400 if customName missing', async (t) => {
    resetMocks();
    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/token-names/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await response.json();
        assert.strictEqual(response.status, 400);
        assert.strictEqual(data.error, 'Custom name required');
    } finally {
        close();
    }
});

test('System Routes - PUT /token-names/:tokenIndex - 200 with upsert and audit on success', async (t) => {
    resetMocks();
    let upsertCalledWith = null;
    mockUpsertTokenName = async (index, name) => {
        upsertCalledWith = { index, name };
    };

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/token-names/2`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customName: 'New Token Name' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.deepStrictEqual(upsertCalledWith, { index: 2, name: 'New Token Name' });
        assert.strictEqual(mockAuditCalls.length, 1);
        assert.strictEqual(mockAuditCalls[0][1], 'token.rename');
        assert.strictEqual(mockAuditCalls[0][2], 'token-2');
        assert.deepStrictEqual(mockAuditCalls[0][3], { customName: 'New Token Name' });
    } finally {
        close();
    }
});

test('System Routes - GET /health-status - 200 and performs cache operations', async (t) => {
    resetMocks();
    let getSummaryCount = 0;
    mockGetServiceErrorSummary = async (id, hours) => {
        getSummaryCount++;
        return { errors: 0 };
    };
    mockListServiceChecks = async () => [{ responseMs: 120, timestamp: Date.now(), ok: true }];
    mockListServiceErrors = async () => [];
    mockGetServiceUptime = async () => ({ uptimePercent: 100 });

    const { url, close } = await startTestApp(systemRoutes);
    try {
        // First call - cache miss
        const response1 = await fetch(`${url}/health-status?hours=10`);
        const data1 = await response1.json();
        assert.strictEqual(response1.status, 200);
        assert.strictEqual(data1.hours, 10);
        assert.strictEqual(data1.services.length, 3);
        assert.strictEqual(getSummaryCount, 3);

        // Reset the counter
        getSummaryCount = 0;

        // Second call - cache hit (should not call service summary because of 60s cache)
        const response2 = await fetch(`${url}/health-status?hours=10`);
        const data2 = await response2.json();
        assert.strictEqual(response2.status, 200);
        assert.deepStrictEqual(data2, data1);
        assert.strictEqual(getSummaryCount, 0);
    } finally {
        close();
    }
});

test('System Routes - GET /health-status - 500 on error', async (t) => {
    resetMocks();
    mockGetServiceUptime = () => Promise.reject(new Error('Uptime DB error'));

    const { url, close } = await startTestApp(systemRoutes);
    try {
        const response = await fetch(`${url}/health-status`);
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Uptime DB error');
    } finally {
        close();
    }
});
