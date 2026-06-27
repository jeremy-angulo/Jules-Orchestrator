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

test('authMiddleware - attachDashboardUser handles Admin API Key', async () => {
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

test('authMiddleware - attachDashboardUser parses cookies and gets user', async () => {
    const mockUser = { id: 1, email: 'test@example.com', role: 'operator' };
    const { attachDashboardUser } = await esmock('../../src/middleware/authMiddleware.js', {
        '../../src/auth/dashboardAuth.js': {
            getDashboardSessionUser: vi.fn(async (token) => {
                if (token === 'valid-token') return mockUser;
                return null;
            })
        },
        '../../src/auth/permissions.js': {},
        '../../src/db/database.js': {}
    });

    const req = {
        originalUrl: '/test',
        get: vi.fn(() => null),
        query: {},
        headers: {
            cookie: 'other_cookie=123; orchestrator_session=valid-token; yet_another=abc'
        }
    };
    const next = vi.fn();

    await attachDashboardUser(req, {}, next);

    expect(req.dashboardUser.email).toBe('test@example.com');
    expect(req.dashboardSessionToken).toBe('valid-token');
    expect(next).toHaveBeenCalled();
});
