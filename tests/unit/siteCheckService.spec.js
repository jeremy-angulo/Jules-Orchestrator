import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('processPage - completes full cycle: analysis -> merge -> fix', async () => {
    const updateResultSpy = vi.fn();
    const startSessionSpy = vi.fn()
        .mockImplementation(async (prompt, agentId, project, options) => {
            if (agentId === 'Site-Check-Analysis') {
                if (options?.onPRCreated) {
                    options.onPRCreated({ prUrl: 'url/123', prNumber: 123 });
                }
                return true;
            }
            return true;
        });

    const mergePRSpy = vi.fn().mockResolvedValue({ status: 'merged' });

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            updateSitePageResult: updateResultSpy
        },
        '../../src/api/julesClient.js': {
            startAndMonitorSession: startSessionSpy
        },
        '../../src/api/githubClient.js': {
            mergePRWithResult: mergePRSpy
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    // To bypass 2 min delay
    vi.useFakeTimers();

    const page = { id: 1, url: '/test-page', requires_admin: 0, requires_auth: 0 };
    const project = { id: 'p1' };

    const processPromise = siteCheck.processPage(page, project, 'fr');

    // Move past the FIX_DELAY
    await vi.runAllTimersAsync();
    await processPromise;

    expect(updateResultSpy).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'ANALYZE' }));
    expect(updateResultSpy).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'ANALYZED' }));
    expect(updateResultSpy).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'FIX' }));
    expect(mergePRSpy).toHaveBeenCalled();
    expect(startSessionSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
});

test('processPage - handles no problem detected (no PR)', async () => {
    const updateResultSpy = vi.fn();
    const startSessionSpy = vi.fn().mockResolvedValue(false);

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            updateSitePageResult: updateResultSpy
        },
        '../../src/api/julesClient.js': {
            startAndMonitorSession: startSessionSpy
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    const page = { id: 1, url: '/clean-page' };
    const project = { id: 'p1' };

    await siteCheck.processPage(page, project);

    expect(updateResultSpy).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'OK' }));
    expect(startSessionSpy).toHaveBeenCalledTimes(1);
});

test('processPage - handles merge failure', async () => {
    const updateResultSpy = vi.fn();
    const startSessionSpy = vi.fn()
        .mockImplementation(async (prompt, agentId, project, options) => {
            if (options?.onPRCreated) options.onPRCreated({ prNumber: 456 });
            return true;
        });
    const mergePRSpy = vi.fn().mockResolvedValue({ status: 'failed', reason: 'conflict' });

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            updateSitePageResult: updateResultSpy
        },
        '../../src/api/julesClient.js': {
            startAndMonitorSession: startSessionSpy
        },
        '../../src/api/githubClient.js': {
            mergePRWithResult: mergePRSpy
        },
        '../../src/utils/logger.js': {
            log: vi.fn()
        }
    });

    vi.useFakeTimers();

    const page = { id: 2, url: '/conflict-page' };
    const project = { id: 'p1' };

    const processPromise = siteCheck.processPage(page, project);

    await vi.runAllTimersAsync();
    await processPromise;

    expect(updateResultSpy).toHaveBeenCalledWith(2, expect.objectContaining({ status: 'ANALYZE' }));
    // After 3 failed merge tries, it should revert to ANALYZE
    expect(updateResultSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ status: 'ANALYZE', screenshotPath: null }));
    expect(mergePRSpy).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
});
