import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';

let mockDb;
let mockJulesClient;
let mockGithubClient;
let mockLogger;
let siteCheckService;

beforeEach(async () => {
  mockDb = {
    pickAndLockSitePage: vi.fn(),
    unlockSitePage: vi.fn(),
    updateSitePageResult: vi.fn(),
    releaseStaleSitePageLocks: vi.fn(),
  };

  mockJulesClient = {
    startAndMonitorSession: vi.fn(),
  };

  mockGithubClient = {
    mergePRWithResult: vi.fn(),
  };

  mockLogger = {
    log: vi.fn(),
  };

  siteCheckService = await esmock('../../src/services/siteCheckService.js', {
    '../../src/db/database.js': mockDb,
    '../../src/api/julesClient.js': mockJulesClient,
    '../../src/api/githubClient.js': mockGithubClient,
    '../../src/utils/logger.js': mockLogger,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('processPage - when no PR is created, marks page status as OK', async () => {
  const page = { id: 10, url: '/dashboard', requires_auth: false, requires_admin: false };
  const project = { id: 'p1', name: 'Project 1' };

  mockJulesClient.startAndMonitorSession.mockResolvedValue(false);

  await siteCheckService.processPage(page, project, 'fr');

  expect(mockDb.updateSitePageResult).toHaveBeenNthCalledWith(1, 10, {
    status: 'ANALYZE',
    screenshotPath: 'agent-screenshots/fr/dashboard/desktop.png',
    issues: null,
  });

  expect(mockJulesClient.startAndMonitorSession).toHaveBeenCalledWith(
    expect.stringContaining('Mission : Analyse visuelle et technique — `/dashboard`'),
    'Site-Check-Analysis',
    project,
    expect.objectContaining({
      onTokenPicked: undefined,
      onPRCreated: expect.any(Function),
    })
  );

  expect(mockDb.updateSitePageResult).toHaveBeenNthCalledWith(2, 10, {
    status: 'OK',
    screenshotPath: 'agent-screenshots/fr/dashboard/desktop.png',
    issues: null,
  });
});

test('processPage - prompts correctly handle root URL, requires_admin, requires_auth, and none', async () => {
  const pageAdmin = { id: 11, url: '/', requires_admin: true, requires_auth: false };
  const pageAuth = { id: 12, url: '/profile', requires_admin: false, requires_auth: true };
  const pageNone = { id: 13, url: '/about', requires_admin: false, requires_auth: false };
  const project = { id: 'p1' };

  let prompts = [];

  mockJulesClient.startAndMonitorSession.mockImplementation(async (prompt) => {
    prompts.push(prompt);
    return false;
  });

  await siteCheckService.processPage(pageAdmin, project, 'en');
  await siteCheckService.processPage(pageAuth, project, 'fr');
  await siteCheckService.processPage(pageNone, project, 'fr');

  expect(prompts[0]).toContain('--auth admin');
  expect(prompts[1]).toContain('--auth user');
  expect(prompts[2]).toContain('--auth none');
});

test('processPage - when PR created but merge fails or throws error across retries', async () => {
  vi.useFakeTimers();

  const page = { id: 15, url: '/checkout', requires_auth: false, requires_admin: false };
  const project = { id: 'p1' };

  mockJulesClient.startAndMonitorSession.mockImplementation(async (prompt, label, proj, options) => {
    if (options && options.onPRCreated) {
      options.onPRCreated({ prUrl: 'https://github.com/org/repo/pull/42', prNumber: 42 });
    }
    return true;
  });

  // Simulate merge warning on 1st try, exception on 2nd try, failure on 3rd try
  mockGithubClient.mergePRWithResult
    .mockResolvedValueOnce({ status: 'failed' }) // no reason provided -> fallback to ''
    .mockRejectedValueOnce(new Error('GitHub API 500'))
    .mockResolvedValueOnce({ status: 'rejected', reason: 'Blocked' });

  const processPromise = siteCheckService.processPage(page, project, 'fr');

  // Advance timers through 3 merge retry waits (30s each)
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.advanceTimersByTimeAsync(30_000);

  await processPromise;

  expect(mockGithubClient.mergePRWithResult).toHaveBeenCalledTimes(3);
  expect(mockDb.updateSitePageResult).toHaveBeenLastCalledWith(15, {
    status: 'ANALYZE',
    screenshotPath: null,
    issues: null,
  });
  expect(mockLogger.log).toHaveBeenCalledWith('warn', expect.stringContaining('Merge PR #42 erreur (2/3): GitHub API 500'));
});

test('processPage - when PR status is skipped, treats as successful merge', async () => {
  vi.useFakeTimers();

  const page = { id: 18, url: '/faq', requires_auth: false, requires_admin: false };
  const project = { id: 'p1' };

  mockJulesClient.startAndMonitorSession.mockImplementation(async (prompt, label, proj, options) => {
    if (options?.onPRCreated) {
      options.onPRCreated({ prUrl: 'https://github.com/org/repo/pull/7', prNumber: 7 });
    }
    return true;
  });

  mockGithubClient.mergePRWithResult.mockResolvedValue({ status: 'skipped' });

  const processPromise = siteCheckService.processPage(page, project, 'fr');

  // Advance timers through fix delay (120s)
  await vi.advanceTimersByTimeAsync(120_000);

  await processPromise;

  expect(mockDb.updateSitePageResult).toHaveBeenNthCalledWith(2, 18, {
    status: 'ANALYZED',
    screenshotPath: 'agent-screenshots/fr/faq/desktop.png',
    issues: null,
  });
});

test('processPage - when PR merge succeeds, transitions to ANALYZED, waits, and triggers fix agent', async () => {
  vi.useFakeTimers();

  const page = { id: 20, url: '/settings', requires_auth: true, requires_admin: false };
  const project = { id: 'p1' };
  const onTokenPicked = vi.fn();

  let sessionCount = 0;
  mockJulesClient.startAndMonitorSession.mockImplementation(async (prompt, label, proj, options) => {
    sessionCount++;
    if (sessionCount === 1 && options?.onPRCreated) {
      options.onPRCreated({ prUrl: 'https://github.com/org/repo/pull/99', prNumber: 99 });
    }
    return true;
  });

  // First merge fails, second merge succeeds
  mockGithubClient.mergePRWithResult
    .mockResolvedValueOnce({ status: 'failed', reason: 'Temporary glitch' })
    .mockResolvedValueOnce({ status: 'merged' });

  const processPromise = siteCheckService.processPage(page, project, 'fr', null, { onTokenPicked });

  // Advance timer for 1st merge retry (30s)
  await vi.advanceTimersByTimeAsync(30_000);

  // Advance timer for fix delay (120s)
  await vi.advanceTimersByTimeAsync(120_000);

  await processPromise;

  expect(mockGithubClient.mergePRWithResult).toHaveBeenCalledTimes(2);

  // NthCall 1: ANALYZE (start of processPage)
  expect(mockDb.updateSitePageResult).toHaveBeenNthCalledWith(1, 20, {
    status: 'ANALYZE',
    screenshotPath: 'agent-screenshots/fr/settings/desktop.png',
    issues: null,
  });

  // NthCall 2: ANALYZED (after successful merge)
  expect(mockDb.updateSitePageResult).toHaveBeenNthCalledWith(2, 20, {
    status: 'ANALYZED',
    screenshotPath: 'agent-screenshots/fr/settings/desktop.png',
    issues: null,
  });

  // NthCall 3: FIX (after fix delay)
  expect(mockDb.updateSitePageResult).toHaveBeenNthCalledWith(3, 20, {
    status: 'FIX',
    screenshotPath: 'agent-screenshots/fr/settings/desktop.png',
    issues: null,
  });

  expect(mockJulesClient.startAndMonitorSession).toHaveBeenCalledTimes(2);
  expect(mockJulesClient.startAndMonitorSession).toHaveBeenLastCalledWith(
    expect.stringContaining('Mission : Correction visuelle et technique — `/settings`'),
    'Site-Check-Fix',
    project,
    { onTokenPicked }
  );
});

test('runSiteCheckCycle - stops immediately if shouldStop returns true', async () => {
  const project = { id: 'p1' };
  const shouldStop = vi.fn().mockReturnValue(true);

  await siteCheckService.runSiteCheckCycle(project, { shouldStop });

  expect(mockDb.releaseStaleSitePageLocks).toHaveBeenCalledWith(30);
  expect(mockDb.pickAndLockSitePage).not.toHaveBeenCalled();
  expect(mockLogger.log).toHaveBeenCalledWith('info', expect.stringContaining('Runner arrêté'));
});

test('runSiteCheckCycle - handles empty page queue and respects shouldStop', async () => {
  vi.useFakeTimers();

  const project = { id: 'p1' };
  mockDb.pickAndLockSitePage.mockResolvedValue(null);

  let stops = 0;
  const shouldStop = () => {
    stops++;
    return stops > 1; // 1st check false, 2nd check true
  };

  const cyclePromise = siteCheckService.runSiteCheckCycle(project, { shouldStop });

  await vi.advanceTimersByTimeAsync(60_000);

  await cyclePromise;

  expect(mockDb.releaseStaleSitePageLocks).toHaveBeenCalledWith(30);
  expect(mockDb.pickAndLockSitePage).toHaveBeenCalledWith('p1', 'site-check-runner');
  expect(mockLogger.log).toHaveBeenCalledWith('info', expect.stringContaining('Cycle complet'));
});

test('runSiteCheckCycle - processes page with zero pauseMs and unlocks on error', async () => {
  vi.useFakeTimers();

  const project = { id: 'p1' };
  const page = { id: 50, url: '/error-page' };

  mockDb.pickAndLockSitePage.mockResolvedValueOnce(page);
  mockJulesClient.startAndMonitorSession.mockRejectedValue(new Error('Fatal session error'));

  let calls = 0;
  const shouldStop = () => {
    calls++;
    return calls > 1;
  };

  await siteCheckService.runSiteCheckCycle(project, { shouldStop, pauseMs: 0 });

  expect(mockDb.unlockSitePage).toHaveBeenCalledWith(50);
  expect(mockLogger.log).toHaveBeenCalledWith('error', expect.stringContaining('Erreur sur /error-page: Fatal session error'));
});

test('runSiteCheckCycle - processes page successfully and pauses for positive pauseMs', async () => {
  vi.useFakeTimers();

  const project = { id: 'p1' };
  const page = { id: 60, url: '/home', requires_auth: false, requires_admin: false };

  mockDb.pickAndLockSitePage.mockResolvedValueOnce(page).mockResolvedValue(null);
  mockJulesClient.startAndMonitorSession.mockResolvedValue(false);

  let iterations = 0;
  const shouldStop = () => {
    iterations++;
    return iterations > 2; // Stop on third check
  };

  const cyclePromise = siteCheckService.runSiteCheckCycle(project, { shouldStop, pauseMs: 5000 });

  // Advance timer for pauseMs after processPage (5000ms)
  await vi.advanceTimersByTimeAsync(5000);

  // Advance timer for empty queue pause (60,000ms)
  await vi.advanceTimersByTimeAsync(60000);

  await cyclePromise;

  expect(mockDb.updateSitePageResult).toHaveBeenCalledWith(60, {
    status: 'OK',
    screenshotPath: 'agent-screenshots/fr/home/desktop.png',
    issues: null,
  });
});
