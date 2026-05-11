import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';

test('authMiddleware - requirePermission blocks if no user', async (t) => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('some.perm');
    const req = { };
    let statusSet = null;
    let jsonSent = null;
    const res = {
        status: (s) => { statusSet = s; return res; },
        json: (j) => { jsonSent = j; return res; }
    };
    const next = t.mock.fn();

    middleware(req, res, next);

    assert.strictEqual(statusSet, 401);
    assert.strictEqual(jsonSent.error, 'Authentication required.');
    assert.strictEqual(next.mock.callCount(), 0);
});

test('authMiddleware - requirePermission allows admin role', async (t) => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {
             hasPermission: () => false
        },
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('some.perm');
    const req = { dashboardUser: { role: 'admin' } };
    const res = {};
    const next = t.mock.fn();

    middleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
});

test('authMiddleware - requirePermission blocks if role lacks permission', async (t) => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {
             hasPermission: () => false
        },
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('restricted.action');
    const req = { dashboardUser: { role: 'viewer' } };
    let statusSet = null;
    let jsonSent = null;
    const res = {
        status: (s) => { statusSet = s; return res; },
        json: (j) => { jsonSent = j; return res; }
    };
    const next = t.mock.fn();

    middleware(req, res, next);

    assert.strictEqual(statusSet, 403);
    assert.strictEqual(jsonSent.error, 'Missing permission: restricted.action');
    assert.strictEqual(next.mock.callCount(), 0);
});

test('authMiddleware - attachDashboardUser handles Admin API Key', async (t) => {
    process.env.DASHBOARD_API_KEY = 'supersecret';

    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: async () => null
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: (h) => h === 'x-admin-key' ? 'supersecret' : null,
        query: {}
    };
    const next = t.mock.fn();

    await attachDashboardUser(req, {}, next);

    assert.strictEqual(req.dashboardUser.role, 'admin');
    assert.strictEqual(req.isAdminKey, true);
    assert.strictEqual(next.mock.callCount(), 1);

    delete process.env.DASHBOARD_API_KEY;
});

test('authMiddleware - attachDashboardUser parses cookies and gets user', async (t) => {
    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: async (token) => {
                if (token === 'valid-token') return { id: 1, email: 'test@example.com', role: 'operator' };
                return null;
            }
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: () => null,
        query: {},
        headers: {
            cookie: 'other_cookie=123; orchestrator_session=valid-token; yet_another=abc'
        }
    };
    const next = t.mock.fn();

    await attachDashboardUser(req, {}, next);

    assert.strictEqual(req.dashboardUser.email, 'test@example.com');
    assert.strictEqual(req.dashboardSessionToken, 'valid-token');
    assert.strictEqual(next.mock.callCount(), 1);
});
