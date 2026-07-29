import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('authMiddleware - requirePermission blocks if no user', async () => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('some.perm');
    const req = { };
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
    expect(next).not.toHaveBeenCalled();
});

test('authMiddleware - requirePermission allows admin role', async () => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {
             hasPermission: vi.fn(() => false)
        },
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('some.perm');
    const req = { dashboardUser: { role: 'admin' } };
    const res = {};
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
});

test('authMiddleware - requirePermission allows role with permission', async () => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {
             hasPermission: vi.fn((role, perm) => {
                 return role === 'operator' && perm === 'dashboard.write';
             })
        },
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('dashboard.write');
    const req = { dashboardUser: { role: 'operator' } };
    const res = {};
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
});

test('authMiddleware - requirePermission blocks if role lacks permission', async () => {
    const { requirePermission } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {
             hasPermission: vi.fn(() => false)
        },
        '../../src/db/database.js': {}
    });

    const middleware = requirePermission('restricted.action');
    const req = { dashboardUser: { role: 'viewer' } };
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing permission: restricted.action' });
    expect(next).not.toHaveBeenCalled();
});

test('authMiddleware - attachDashboardUser handles Admin API Key via header', async () => {
    vi.stubEnv('DASHBOARD_API_KEY', 'supersecret');

    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: vi.fn(async () => null)
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: vi.fn((h) => h === 'x-admin-key' ? 'supersecret' : null),
        query: {}
    };
    const next = vi.fn();

    await attachDashboardUser(req, {}, next);

    expect(req.dashboardUser.role).toBe('admin');
    expect(req.isAdminKey).toBe(true);
    expect(next).toHaveBeenCalled();

    vi.unstubAllEnvs();
});

test('authMiddleware - attachDashboardUser handles Admin API Key via query parameter', async () => {
    vi.stubEnv('DASHBOARD_API_KEY', 'supersecret_query');

    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: vi.fn(async () => null)
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: vi.fn(() => null),
        query: { key: 'supersecret_query' }
    };
    const next = vi.fn();

    await attachDashboardUser(req, {}, next);

    expect(req.dashboardUser.role).toBe('admin');
    expect(req.isAdminKey).toBe(true);
    expect(next).toHaveBeenCalled();

    vi.unstubAllEnvs();
});

test('authMiddleware - attachDashboardUser ignores query/header keys if DASHBOARD_API_KEY is not set', async () => {
    // Make sure process.env.DASHBOARD_API_KEY is undefined
    vi.stubEnv('DASHBOARD_API_KEY', '');

    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: vi.fn(async () => ({ email: 'session_user@test.com' }))
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: vi.fn((h) => h === 'x-admin-key' ? 'supersecret' : null),
        query: { key: 'supersecret' },
        headers: { cookie: 'orchestrator_session=tok' }
    };
    const next = vi.fn();

    await attachDashboardUser(req, {}, next);

    expect(req.dashboardUser.email).toBe('session_user@test.com');
    expect(req.isAdminKey).toBeUndefined();
    expect(next).toHaveBeenCalled();

    vi.unstubAllEnvs();
});

test('authMiddleware - attachDashboardUser handles mismatched query/header keys', async () => {
    vi.stubEnv('DASHBOARD_API_KEY', 'secret_key');

    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: vi.fn(async () => null)
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: vi.fn(() => 'wrong_key'),
        query: { key: 'wrong_key_query' },
        headers: {}
    };
    const next = vi.fn();

    await attachDashboardUser(req, {}, next);

    expect(req.dashboardUser).toBeNull();
    expect(req.isAdminKey).toBeUndefined();
    expect(next).toHaveBeenCalled();

    vi.unstubAllEnvs();
});

test('authMiddleware - attachDashboardUser parses cookies with various inputs', async () => {
    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: vi.fn(async (token) => ({ token }))
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    // Test cases for cookie inputs and their expected matched token
    const testCases = [
        { cookie: 'other_cookie=123; orchestrator_session=valid-token; yet_another=abc', expected: 'valid-token' },
        { cookie: 'orchestrator_session=encoded%20val%3D123', expected: 'encoded val=123' },
        { cookie: '; =keyless; orchestrator_session=token3', expected: 'token3' },
        { cookie: 'invalidcookie; orchestrator_session=token4', expected: 'token4' },
        { cookie: undefined, expected: undefined },
        { cookie: '', expected: undefined }
    ];

    for (const { cookie, expected } of testCases) {
        const req = {
            originalUrl: '/test',
            get: vi.fn(() => null),
            query: {},
            headers: { cookie }
        };
        const next = vi.fn();

        await attachDashboardUser(req, {}, next);
        expect(req.dashboardSessionToken).toBe(expected);
        expect(req.dashboardUser.token).toBe(expected);
        expect(next).toHaveBeenCalled();
    }
});

test('authMiddleware - requireDashboardAuth allows authenticated user', async () => {
    const { requireDashboardAuth } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = { dashboardUser: { id: 1, email: 'user@test.com' } };
    const res = {};
    const next = vi.fn();

    requireDashboardAuth(req, res, next);

    expect(next).toHaveBeenCalled();
});

test('authMiddleware - requireDashboardAuth redirects to login for unauthenticated non-API requests', async () => {
    const { requireDashboardAuth } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = { originalUrl: '/dashboard' };
    const res = {
        redirect: vi.fn()
    };
    const next = vi.fn();

    requireDashboardAuth(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
});

test('authMiddleware - requireDashboardAuth returns 401 JSON for unauthenticated API requests', async () => {
    const { requireDashboardAuth } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const apiUrls = ['/api/status', '/api', '/auth/login'];

    for (const originalUrl of apiUrls) {
        const req = { originalUrl };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
        const next = vi.fn();

        requireDashboardAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
        expect(next).not.toHaveBeenCalled();
    }
});

test('authMiddleware - requireCriticalConfirmation succeeds with proper header', async () => {
    const { requireCriticalConfirmation } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        get: vi.fn((h) => h === 'x-confirm-action' ? 'CONFIRM' : null)
    };
    const res = {};
    const next = vi.fn();

    requireCriticalConfirmation(req, res, next);

    expect(next).toHaveBeenCalled();
});

test('authMiddleware - requireCriticalConfirmation fails with missing/invalid header', async () => {
    const { requireCriticalConfirmation } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const badHeaders = [null, 'YES', 'confirm'];

    for (const hVal of badHeaders) {
        const req = {
            get: vi.fn(() => hVal)
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
        const next = vi.fn();

        requireCriticalConfirmation(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Missing x-confirm-action=CONFIRM header for critical action.' });
        expect(next).not.toHaveBeenCalled();
    }
});

test('authMiddleware - audit records event with user details and IP sources', async () => {
    const mockRecordAuditEvent = vi.fn();
    const { audit } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {},
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {
            recordAuditEvent: mockRecordAuditEvent
        }
    });

    // Case 1: All info present, IP via req.ip
    const req1 = {
        ip: '192.168.1.1',
        dashboardUser: { id: 42, email: 'operator@test.com' },
        get: vi.fn(() => null),
        connection: {}
    };
    await audit(req1, 'create_assignment', 'assignment:123', { name: 'Test' });

    expect(mockRecordAuditEvent).toHaveBeenLastCalledWith({
        userId: 42,
        userEmail: 'operator@test.com',
        action: 'create_assignment',
        target: 'assignment:123',
        details: { name: 'Test' },
        ip: '192.168.1.1'
    });

    // Case 2: Unauthenticated / minimal req info, IP via x-forwarded-for header
    const req2 = {
        dashboardUser: null,
        get: vi.fn((h) => h === 'x-forwarded-for' ? '10.0.0.5' : null),
        connection: {}
    };
    await audit(req2, 'anonymous_login_fail', 'login', null);

    expect(mockRecordAuditEvent).toHaveBeenLastCalledWith({
        userId: null,
        userEmail: null,
        action: 'anonymous_login_fail',
        target: 'login',
        details: null,
        ip: '10.0.0.5'
    });

    // Case 3: IP via req.connection.remoteAddress
    const req3 = {
        dashboardUser: null,
        get: vi.fn(() => null),
        connection: { remoteAddress: '2001:db8::1' }
    };
    await audit(req3, 'system_restart', 'orchestrator', null);

    expect(mockRecordAuditEvent).toHaveBeenLastCalledWith({
        userId: null,
        userEmail: null,
        action: 'system_restart',
        target: 'orchestrator',
        details: null,
        ip: '2001:db8::1'
    });

    // Case 4: No IP sources
    const req4 = {
        dashboardUser: null,
        get: vi.fn(() => null),
        connection: {}
    };
    await audit(req4, 'mystery_action', 'unknown', null);

    expect(mockRecordAuditEvent).toHaveBeenLastCalledWith({
        userId: null,
        userEmail: null,
        action: 'mystery_action',
        target: 'unknown',
        details: null,
        ip: null
    });
});
