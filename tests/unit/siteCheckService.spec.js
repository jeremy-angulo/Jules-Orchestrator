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

test('processPage - handles merge error throw gracefully', async () => {
    const updateResultSpy = vi.fn();
    const startSessionSpy = vi.fn()
        .mockImplementation(async (prompt, agentId, project, options) => {
            if (options?.onPRCreated) options.onPRCreated({ prNumber: 789 });
            return true;
        });
    const mergePRSpy = vi.fn().mockRejectedValue(new Error('GitHub API down'));
    const logSpy = vi.fn();

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
            log: logSpy
        }
    });

    vi.useFakeTimers();

    const page = { id: 3, url: '/error-page' };
    const project = { id: 'p1' };

    const processPromise = siteCheck.processPage(page, project);

    await vi.runAllTimersAsync();
    await processPromise;

    expect(updateResultSpy).toHaveBeenCalledWith(3, expect.objectContaining({ status: 'ANALYZE' }));
    expect(updateResultSpy).toHaveBeenLastCalledWith(3, expect.objectContaining({ status: 'ANALYZE', screenshotPath: null }));
    expect(mergePRSpy).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('GitHub API down'));

    vi.useRealTimers();
});

test('runSiteCheckCycle - exits immediately if shouldStop is true', async () => {
    const releaseLocksSpy = vi.fn();
    const pickPageSpy = vi.fn();
    const logSpy = vi.fn();

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: releaseLocksSpy,
            pickAndLockSitePage: pickPageSpy
        },
        '../../src/utils/logger.js': {
            log: logSpy
        }
    });

    const project = { id: 'p1' };
    const shouldStop = vi.fn().mockReturnValue(true);

    await siteCheck.runSiteCheckCycle(project, { shouldStop });

    expect(releaseLocksSpy).toHaveBeenCalledWith(30);
    expect(pickPageSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Runner arrêté'));
});

test('runSiteCheckCycle - handles no page available', async () => {
    const releaseLocksSpy = vi.fn();
    const pickPageSpy = vi.fn().mockResolvedValue(null);
    const logSpy = vi.fn();

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: releaseLocksSpy,
            pickAndLockSitePage: pickPageSpy
        },
        '../../src/utils/logger.js': {
            log: logSpy
        }
    });

    const project = { id: 'p1' };
    let callsCount = 0;
    const shouldStop = vi.fn().mockImplementation(() => {
        callsCount++;
        return callsCount > 1; // Stop on second check
    });

    vi.useFakeTimers();

    const runPromise = siteCheck.runSiteCheckCycle(project, { shouldStop, locale: 'fr' });

    // Advance timers so the setTimeout of 60s completes
    await vi.advanceTimersByTimeAsync(60000);
    await runPromise;

    expect(releaseLocksSpy).toHaveBeenCalledWith(30);
    expect(pickPageSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Cycle complet (locale=fr)'));
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Runner arrêté'));

    vi.useRealTimers();
});

test('runSiteCheckCycle - processes page and applies pauseMs', async () => {
    const releaseLocksSpy = vi.fn();
    const pickPageSpy = vi.fn().mockResolvedValue({ id: 10, url: '/test' });
    const updateResultSpy = vi.fn();
    const startSessionSpy = vi.fn().mockResolvedValue(false); // No PR -> complete cycle instantly
    const logSpy = vi.fn();

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: releaseLocksSpy,
            pickAndLockSitePage: pickPageSpy,
            updateSitePageResult: updateResultSpy
        },
        '../../src/api/julesClient.js': {
            startAndMonitorSession: startSessionSpy
        },
        '../../src/utils/logger.js': {
            log: logSpy
        }
    });

    const project = { id: 'p1' };
    let callsCount = 0;
    const shouldStop = vi.fn().mockImplementation(() => {
        callsCount++;
        return callsCount > 1; // Stop on second check
    });

    vi.useFakeTimers();

    const runPromise = siteCheck.runSiteCheckCycle(project, { shouldStop, pauseMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await runPromise;

    expect(pickPageSpy).toHaveBeenCalledTimes(1);
    expect(updateResultSpy).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'OK' }));
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Runner arrêté'));

    vi.useRealTimers();
});

test('runSiteCheckCycle - unlocks page if processPage throws an error', async () => {
    const releaseLocksSpy = vi.fn();
    const pickPageSpy = vi.fn().mockResolvedValue({ id: 20, url: '/fail' });
    const unlockPageSpy = vi.fn();
    const startSessionSpy = vi.fn().mockRejectedValue(new Error('Process Page Failed'));
    const logSpy = vi.fn();

    const siteCheck = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: releaseLocksSpy,
            pickAndLockSitePage: pickPageSpy,
            unlockSitePage: unlockPageSpy,
            updateSitePageResult: vi.fn() // mock so processPage proceeds to startSession
        },
        '../../src/api/julesClient.js': {
            startAndMonitorSession: startSessionSpy
        },
        '../../src/utils/logger.js': {
            log: logSpy
        }
    });

    const project = { id: 'p1' };
    let callsCount = 0;
    const shouldStop = vi.fn().mockImplementation(() => {
        callsCount++;
        return callsCount > 1; // Stop on second check
    });

    vi.useFakeTimers();

    const runPromise = siteCheck.runSiteCheckCycle(project, { shouldStop, pauseMs: 500 });

    await vi.advanceTimersByTimeAsync(500);
    await runPromise;

    expect(pickPageSpy).toHaveBeenCalledTimes(1);
    expect(unlockPageSpy).toHaveBeenCalledWith(20);
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('Erreur sur /fail: Process Page Failed'));
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Runner arrêté'));

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
