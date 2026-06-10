import { test, expect, vi } from 'vitest';
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

test('Site Check Routes - GET / returns config and stats', async () => {
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
        expect(response.status).toBe(200);
        expect(data.config).toEqual(mockConfig);
        expect(data.stats).toEqual(mockStats);
        expect(data.running).toBe(true);
    } finally {
        close();
    }
});

test('Site Check Routes - POST /toggle updates config and toggles runner', async () => {
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
                    expect(projectId).toBe('test-proj');
                    expect(enabled).toBe(true);
                    expect(baseUrl).toBe('https://example.com');
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
        expect(response.status).toBe(200);
        expect(toggleCalled).toBe(true);
        expect(auditCalled).toBe(true);
        expect(data.ok).toBe(true);
    } finally {
        close();
    }
});

test('Site Check Routes - GET /pages returns list of pages', async () => {
    const mockPages = [{ url: '/home', status: 'OK' }];
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            listSitePages: async (projectId, opts) => {
                expect(projectId).toBe('test-proj');
                expect(opts.status).toBe('OK');
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
        const response = await fetch(url + '/projects/test-proj/site-check/pages?status=OK');
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data.pages).toEqual(mockPages);
    } finally {
        close();
    }
});

test('Site Check Routes - POST /release-locks releases stale locks', async () => {
    let releaseCalled = false;
    const siteCheckRoutes = await esmock('../../src/routes/siteCheckRoutes.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: async (age) => {
                releaseCalled = true;
                expect(age).toBe(30);
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
        expect(response.status).toBe(200);
        expect(releaseCalled).toBe(true);
        expect(data.ok).toBe(true);
    } finally {
        close();
    }
});

test('Site Check Routes - handles errors', async () => {
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
        expect(response.status).toBe(500);
        expect(data.error).toBe('DB Error');
    } finally {
        close();
    }
});
