import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import express from 'express';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/projects/:projectId/site-check', router);
    const server = app.listen(0);
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
    };
}

test('Site Check Routes - GET / returns config and stats', async (t) => {
    const mockConfig = { enabled: true, baseUrl: 'https://example.com', pauseMs: 10000 };
    const mockStats = { pagesCount: 10, checkedCount: 5 };

    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            getSiteCheckConfig: async (projectId) => projectId === 'test-proj' ? mockConfig : null,
            getSiteCheckStats: async (projectId) => projectId === 'test-proj' ? mockStats : {}
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isSiteCheckRunning: (projectId) => projectId === 'test-proj'
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.config, mockConfig);
        assert.deepStrictEqual(data.stats, mockStats);
        assert.strictEqual(data.running, true);
    } finally {
        close();
    }
});

test('Site Check Routes - GET / returns default config when database returns null config', async (t) => {
    const mockStats = { pagesCount: 10, checkedCount: 5 };

    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            getSiteCheckConfig: async () => null,
            getSiteCheckStats: async () => mockStats
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isSiteCheckRunning: () => false
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(data.config, { enabled: false, baseUrl: null, pauseMs: 5000 });
        assert.deepStrictEqual(data.stats, mockStats);
        assert.strictEqual(data.running, false);
    } finally {
        close();
    }
});

test('Site Check Routes - POST /toggle updates config and toggles runner', async (t) => {
    let toggleCalled = false;
    let auditCalled = false;
    const mockConfig = { enabled: true, baseUrl: 'https://example.com', pauseMs: 5000 };

    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            getSiteCheckConfig: async () => mockConfig,
            getSiteCheckStats: async () => ({})
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                toggleSiteCheck: async (projectId, enabled, baseUrl, pauseMs, locale, concurrency) => {
                    toggleCalled = true;
                    assert.strictEqual(projectId, 'test-proj');
                    assert.strictEqual(enabled, true);
                    assert.strictEqual(baseUrl, 'https://example.com');
                },
                isSiteCheckRunning: () => true
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => { auditCalled = true; }
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, baseUrl: 'https://example.com' })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(toggleCalled, true);
        assert.strictEqual(auditCalled, true);
        assert.strictEqual(data.ok, true);
    } finally {
        close();
    }
});

test('Site Check Routes - POST /toggle works with null body / missing properties and uses defaults', async (t) => {
    let toggleCalled = false;
    let auditCalled = false;
    const mockConfig = { enabled: true, baseUrl: 'https://example.com', pauseMs: 5000 };

    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            getSiteCheckConfig: async () => mockConfig,
            getSiteCheckStats: async () => ({})
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                toggleSiteCheck: async (projectId, enabled, baseUrl, pauseMs, locale, concurrency) => {
                    toggleCalled = true;
                    assert.strictEqual(projectId, 'test-proj');
                    assert.strictEqual(enabled, false);
                    assert.strictEqual(baseUrl, undefined);
                    assert.strictEqual(pauseMs, 5000);
                    assert.strictEqual(locale, 'fr');
                    assert.strictEqual(concurrency, 1);
                },
                isSiteCheckRunning: () => true
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => { auditCalled = true; }
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(toggleCalled, true);
        assert.strictEqual(auditCalled, true);
        assert.strictEqual(data.ok, true);
    } finally {
        close();
    }
});

test('Site Check Routes - GET /pages returns list of pages with specified limits/offsets', async (t) => {
    const mockPages = [{ url: '/home', status: 'OK' }];
    let listSitePagesCalled = false;
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            listSitePages: async (projectId, opts) => {
                listSitePagesCalled = true;
                assert.strictEqual(projectId, 'test-proj');
                assert.strictEqual(opts.status, 'OK');
                assert.strictEqual(opts.limit, 150);
                assert.strictEqual(opts.offset, 10);
                return mockPages;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/pages?status=OK&limit=150&offset=10');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(listSitePagesCalled, true);
        assert.deepStrictEqual(data.pages, mockPages);
    } finally {
        close();
    }
});

test('Site Check Routes - GET /pages caps limit at 500 and uses default offset (0)', async (t) => {
    const mockPages = [{ url: '/home', status: 'OK' }];
    let listSitePagesCalled = false;
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            listSitePages: async (projectId, opts) => {
                listSitePagesCalled = true;
                assert.strictEqual(projectId, 'test-proj');
                assert.strictEqual(opts.limit, 500);
                assert.strictEqual(opts.offset, 0);
                return mockPages;
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/pages?limit=600');
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(listSitePagesCalled, true);
        assert.deepStrictEqual(data.pages, mockPages);
    } finally {
        close();
    }
});

test('Site Check Routes - POST /release-locks releases stale locks', async (t) => {
    let releaseCalled = false;
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: async (age) => {
                releaseCalled = true;
                assert.strictEqual(age, 30);
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/release-locks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxAgeMinutes: 30 })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(releaseCalled, true);
        assert.strictEqual(data.ok, true);
    } finally {
        close();
    }
});

test('Site Check Routes - POST /release-locks handles missing maxAgeMinutes and defaults to 0', async (t) => {
    let releaseCalled = false;
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: async (age) => {
                releaseCalled = true;
                assert.strictEqual(age, 0);
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/release-locks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(releaseCalled, true);
        assert.strictEqual(data.ok, true);
    } finally {
        close();
    }
});

test('Site Check Routes - handles errors on GET /', async (t) => {
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            getSiteCheckConfig: async () => { throw new Error('DB Error'); }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check');
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'DB Error');
    } finally {
        close();
    }
});

test('Site Check Routes - handles errors on POST /toggle', async (t) => {
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                toggleSiteCheck: async () => { throw new Error('Toggle Error'); }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Toggle Error');
    } finally {
        close();
    }
});

test('Site Check Routes - handles errors on GET /pages', async (t) => {
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            listSitePages: async () => { throw new Error('Pages Error'); }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/pages');
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Pages Error');
    } finally {
        close();
    }
});

test('Site Check Routes - handles errors on POST /release-locks', async (t) => {
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: async () => { throw new Error('Release Error'); }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(siteCheckRoutes.default);
    try {
        const response = await fetch(url + '/projects/test-proj/site-check/release-locks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxAgeMinutes: 30 })
        });
        const data = await response.json();
        assert.strictEqual(response.status, 500);
        assert.strictEqual(data.error, 'Release Error');
    } finally {
        close();
    }
});
