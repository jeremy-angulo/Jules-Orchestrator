import { test, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

let siteChecks;
let executeWithRetryMock;
let invalidateSiteCheckCacheMock;
let siteCheckStatsCacheMock;
let siteCheckPagesCacheMock;

beforeEach(async () => {
    executeWithRetryMock = vi.fn();
    invalidateSiteCheckCacheMock = vi.fn();
    siteCheckStatsCacheMock = {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn()
    };
    siteCheckPagesCacheMock = {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn()
    };

    siteChecks = await esmock('../../src/db/siteChecks.js', {
        '../../src/db/core.js': {
            executeWithRetry: executeWithRetryMock
        },
        '../../src/db/cache.js': {
            invalidateSiteCheckCache: invalidateSiteCheckCacheMock,
            siteCheckStatsCache: siteCheckStatsCacheMock,
            siteCheckPagesCache: siteCheckPagesCacheMock
        }
    });
});

test('getSiteCheckConfig - returns config if found', async () => {
    executeWithRetryMock.mockResolvedValue({
        rows: [{
            site_check_enabled: 1,
            site_check_base_url: 'https://test.com',
            site_check_pause_ms: 1000,
            site_check_locale: 'en',
            site_check_concurrency: 2
        }]
    });

    const config = await siteChecks.getSiteCheckConfig('p1');
    expect(config).toEqual({
        enabled: true,
        baseUrl: 'https://test.com',
        pauseMs: 1000,
        locale: 'en',
        concurrency: 2
    });
    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        args: ['p1']
    }));
});

test('getSiteCheckConfig - returns null if not found', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [] });
    const config = await siteChecks.getSiteCheckConfig('p1');
    expect(config).toBeNull();
});

test('updateSiteCheckConfig - updates with correct values', async () => {
    await siteChecks.updateSiteCheckConfig('p1', {
        enabled: true,
        baseUrl: 'https://new.com',
        pauseMs: 2000,
        locale: 'fr',
        concurrency: 3
    });

    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE projects_config'),
        args: [1, 'https://new.com', 2000, 'fr', 3, expect.any(Number), 'p1']
    }));
});

test('pickAndLockSitePage - locks and returns page with parsed issues', async () => {
    executeWithRetryMock.mockResolvedValue({
        rows: [{
            id: 1,
            project_id: 'p1',
            issues: '["issue1"]'
        }]
    });

    const page = await siteChecks.pickAndLockSitePage('p1', 'agent1');

    expect(page).toEqual({
        id: 1,
        project_id: 'p1',
        issues: ['issue1']
    });
    expect(invalidateSiteCheckCacheMock).toHaveBeenCalledWith('p1');
});

test('pickAndLockSitePage - returns null if no page available', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [] });
    const page = await siteChecks.pickAndLockSitePage('p1', 'agent1');
    expect(page).toBeNull();
    expect(invalidateSiteCheckCacheMock).not.toHaveBeenCalled();
});

test('lockSitePage - locks and invalidates cache', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [{ project_id: 'p1' }] });
    await siteChecks.lockSitePage(1, 'agent1');
    expect(invalidateSiteCheckCacheMock).toHaveBeenCalledWith('p1');
});

test('unlockSitePage - unlocks and invalidates cache', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [{ project_id: 'p1' }] });
    await siteChecks.unlockSitePage(1);
    expect(invalidateSiteCheckCacheMock).toHaveBeenCalledWith('p1');
});

test('updateSitePageResult - updates and invalidates cache', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [{ project_id: 'p1' }] });
    await siteChecks.updateSitePageResult(1, {
        status: 'OK',
        screenshotPath: '/path/to/img.png',
        issues: ['issue1']
    });

    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        args: [
            'OK',
            '/path/to/img.png',
            '["issue1"]',
            expect.any(String),
            expect.any(String),
            1
        ]
    }));
    expect(invalidateSiteCheckCacheMock).toHaveBeenCalledWith('p1');
});

test('markSitePageFixed - marks fixed and invalidates cache', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [{ project_id: 'p1' }] });
    await siteChecks.markSitePageFixed(1);
    expect(invalidateSiteCheckCacheMock).toHaveBeenCalledWith('p1');
});

test('getSiteCheckStats - returns from cache if available', async () => {
    siteCheckStatsCacheMock.get.mockReturnValue({ total: 10 });
    const stats = await siteChecks.getSiteCheckStats('p1');
    expect(stats).toEqual({ total: 10 });
    expect(executeWithRetryMock).not.toHaveBeenCalled();
});

test('getSiteCheckStats - fetches from DB and caches if not in cache', async () => {
    siteCheckStatsCacheMock.get.mockReturnValue(null);
    executeWithRetryMock.mockResolvedValue({
        rows: [{
            total: 10,
            ok: 5,
            fix: 2,
            analyze: 3,
            never_analyzed: 1
        }]
    });

    const stats = await siteChecks.getSiteCheckStats('p1');
    expect(stats).toEqual({
        total: 10,
        ok: 5,
        fix: 2,
        analyze: 3,
        neverAnalyzed: 1
    });
    expect(siteCheckStatsCacheMock.set).toHaveBeenCalledWith('p1', stats);
});

test('listSitePages - returns from cache if available and applies filters', async () => {
    const mockPages = [
        { id: 1, status: 'OK', group_name: 'A', issues: '["i1"]' },
        { id: 2, status: 'ANALYZE', group_name: 'B', issues: null }
    ];
    siteCheckPagesCacheMock.get.mockReturnValue(mockPages);

    const pages = await siteChecks.listSitePages('p1', { status: 'OK' });
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe(1);
    expect(executeWithRetryMock).not.toHaveBeenCalled();
});

test('listSitePages - fetches from DB, parses issues, caches and applies filters', async () => {
    siteCheckPagesCacheMock.get.mockReturnValue(null);
    executeWithRetryMock.mockResolvedValue({
        rows: [
            { id: 1, status: 'OK', group_name: 'A', issues: '["i1"]' },
            { id: 2, status: 'ANALYZE', group_name: 'B', issues: null }
        ]
    });

    const pages = await siteChecks.listSitePages('p1', { limit: 1 });
    expect(pages).toHaveLength(1);
    expect(pages[0].issues).toEqual(['i1']);
    expect(siteCheckPagesCacheMock.set).toHaveBeenCalled();
});

test('releaseStaleSitePageLocks - clears cache', async () => {
    await siteChecks.releaseStaleSitePageLocks(60);
    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        args: ['-60']
    }));
    expect(siteCheckStatsCacheMock.clear).toHaveBeenCalled();
    expect(siteCheckPagesCacheMock.clear).toHaveBeenCalled();
});

test('getSiteCheckConfig - applies default fallback values when row contains null or falsy fields', async () => {
    executeWithRetryMock.mockResolvedValue({
        rows: [{
            site_check_enabled: 0,
            site_check_base_url: null,
            site_check_pause_ms: null,
            site_check_locale: null,
            site_check_concurrency: null
        }]
    });

    const config = await siteChecks.getSiteCheckConfig('p1');
    expect(config).toEqual({
        enabled: false,
        baseUrl: '',
        pauseMs: 5000,
        locale: 'fr',
        concurrency: 1
    });
});

test('updateSiteCheckConfig - falls back to default options when parameters are missing or null', async () => {
    await siteChecks.updateSiteCheckConfig('p2', {});

    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE projects_config'),
        args: [0, null, 5000, 'fr', 1, expect.any(Number), 'p2']
    }));
});

test('pickAndLockSitePage - handles row with null issues property', async () => {
    executeWithRetryMock.mockResolvedValue({
        rows: [{
            id: 2,
            project_id: 'p1',
            issues: null
        }]
    });

    const page = await siteChecks.pickAndLockSitePage('p1', 'agent2');
    expect(page).toEqual({
        id: 2,
        project_id: 'p1',
        issues: null
    });
});

test('updateSitePageResult - handles missing optional screenshotPath and issues', async () => {
    executeWithRetryMock.mockResolvedValue({ rows: [{ project_id: 'p1' }] });
    await siteChecks.updateSitePageResult(10, { status: 'ANALYZE' });

    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        args: [
            'ANALYZE',
            null,
            null,
            expect.any(String),
            expect.any(String),
            10
        ]
    }));
});

test('getSiteCheckStats - handles empty DB row with zero defaults', async () => {
    siteCheckStatsCacheMock.get.mockReturnValue(null);
    executeWithRetryMock.mockResolvedValue({ rows: [undefined] });

    const stats = await siteChecks.getSiteCheckStats('p1');
    expect(stats).toEqual({
        total: 0,
        ok: 0,
        fix: 0,
        analyze: 0,
        neverAnalyzed: 0
    });
});

test('listSitePages - filters by group_name and uses default options', async () => {
    const mockPages = [
        { id: 1, status: 'OK', group_name: 'admin', issues: null },
        { id: 2, status: 'OK', group_name: 'user', issues: null }
    ];
    siteCheckPagesCacheMock.get.mockReturnValue(mockPages);

    const pages = await siteChecks.listSitePages('p1', { group: 'admin' });
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe(1);

    // Call without second argument to verify default options parameter
    const allPages = await siteChecks.listSitePages('p1');
    expect(allPages).toHaveLength(2);
});

test('releaseStaleSitePageLocks - uses default maxAgeMinutes of 30 when omitted', async () => {
    await siteChecks.releaseStaleSitePageLocks();
    expect(executeWithRetryMock).toHaveBeenCalledWith(expect.objectContaining({
        args: ['-30']
    }));
});
