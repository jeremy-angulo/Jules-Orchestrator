import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import express from 'express';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/', router);
    const server = app.listen(0);
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
    };
}

test('User Routes - GET / returns list of users', async (t) => {
    const mockUsers = [{ id: 1, email: 'user1@example.com', role: 'admin' }];
    const userRoutes = await esmock('../../src/routes/userRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            listDashboardUsers: async () => mockUsers
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(userRoutes);
    try {
        const response = await fetch(url + '/');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.users, mockUsers);
    } finally {
        close();
    }
});

test('User Routes - POST / creates a user', async (t) => {
    const newUser = { id: 1, email: 'new@example.com', role: 'editor' };
    const userRoutes = await esmock('../../src/routes/userRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            createDashboardUser: async () => newUser
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(userRoutes);
    try {
        const response = await fetch(url + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@example.com', password: 'password123', role: 'editor' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 201);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.user.email, 'new@example.com');

        const failResponse = await fetch(url + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@example.com' })
        });
        assert.strictEqual(failResponse.status, 400);
    } finally {
        close();
    }
});

test('User Routes - PATCH /:id updates user role', async (t) => {
    let calledWith = null;
    const updatedUser = { id: '123', email: 'user@example.com', role: 'admin' };
    const userRoutes = await esmock('../../src/routes/userRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            updateDashboardUserRole: async (id, role) => {
                calledWith = { id, role };
                return updatedUser;
            }
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(userRoutes);
    try {
        const response = await fetch(url + '/123', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.deepStrictEqual(calledWith, { id: '123', role: 'admin' });

        const failResponse = await fetch(url + '/123', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(failResponse.status, 400);
    } finally {
        close();
    }
});

test('User Routes - DELETE /:id deletes user', async (t) => {
    let calledWith = null;
    const userRoutes = await esmock('../../src/routes/userRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            deleteDashboardUser: async (id) => {
                calledWith = id;
                return true;
            }
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(userRoutes);
    try {
        const response = await fetch(url + '/456', {
            method: 'DELETE'
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(calledWith, '456');
    } finally {
        close();
    }
});

test('User Routes - handles service errors', async (t) => {
    const userRoutes = await esmock('../../src/routes/userRoutes.js', {
        '../../src/auth/dashboardAuth.js': {
            listDashboardUsers: async () => { throw new Error('Database error'); }
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(userRoutes);
    try {
        const response = await fetch(url + '/');
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Database error');
    } finally {
        close();
    }
});
