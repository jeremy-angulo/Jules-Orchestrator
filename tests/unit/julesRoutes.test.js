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
