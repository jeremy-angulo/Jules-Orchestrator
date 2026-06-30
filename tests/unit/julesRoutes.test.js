import test from 'node:test';
import assert from 'node:assert/strict';
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

test('Jules Routes - GET /sources returns list of sources', async (t) => {
    const mockSources = { sources: [{ id: 's1', name: 'Source 1' }] };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listSources: async (project, limit) => {
                assert.strictEqual(project, 'System');
                assert.strictEqual(limit, 100);
                return mockSources;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(julesRoutes);
    try {
        const response = await fetch(url + '/sources');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data, mockSources);
    } finally {
        close();
    }
});

test('Jules Routes - GET /sources/:id returns source', async (t) => {
    const mockSource = { id: 's1', name: 'Source 1' };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSource: async (agent, id) => {
                assert.strictEqual(agent, 'System');
                assert.strictEqual(id, 's1');
                return mockSource;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(julesRoutes);
    try {
        const response = await fetch(url + '/sources/s1');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data, mockSource);
    } finally {
        close();
    }
});

test('Jules Routes - GET /sources/:id returns 404', async (t) => {
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSource: async () => null
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(julesRoutes);
    try {
        const response = await fetch(url + '/sources/unknown');
        const data = await response.json();
        assert.strictEqual(response.status, 404);
        assert.strictEqual(data.error, 'Source not found');
    } finally {
        close();
    }
});

test('Jules Routes - GET /sessions/:id returns session', async (t) => {
    const mockSession = { name: 'sessions/123', state: 'COMPLETED' };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            getSession: async (agent, id) => {
                assert.strictEqual(agent, 'System');
                assert.strictEqual(id, '123');
                return mockSession;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(julesRoutes);
    try {
        const response = await fetch(url + '/sessions/123');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data, mockSession);
    } finally {
        close();
    }
});

test('Jules Routes - GET /sessions/:id/activities returns activities', async (t) => {
    const mockActivities = { activities: [{ id: 'a1' }] };
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listActivities: async (agent, id, limit) => {
                assert.strictEqual(agent, 'System');
                assert.strictEqual(id, '123');
                assert.strictEqual(limit, 100);
                return mockActivities;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(julesRoutes);
    try {
        const response = await fetch(url + '/sessions/123/activities');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data, mockActivities);
    } finally {
        close();
    }
});

test('Jules Routes - GET /sources handles error', async (t) => {
    const julesRoutes = await esmock('../../src/routes/julesRoutes.js', {
        '../../src/api/julesClient.js': {
            listSources: async () => {
                throw new Error('Jules API error');
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(julesRoutes);
    try {
        const response = await fetch(url + '/sources');
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Jules API error');
    } finally {
        close();
    }
});
