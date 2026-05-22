import test from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';

test('siteCheckService - processPage handles successful analysis without PR', async (t) => {
  let updatedStatus = null;
  const mockPage = { id: 1, url: '/test-page', requires_admin: 0, requires_auth: 0 };
  const mockProject = { id: 'project-1' };

  const siteCheckService = await esmock('../../src/services/siteCheckService.js', {
    '../../src/db/database.js': {
      updateSitePageResult: async (id, data) => {
        updatedStatus = data.status;
      }
    },
    '../../src/api/julesClient.js': {
      startAndMonitorSession: async () => true
    },
    '../../src/api/githubClient.js': {
      mergePRWithResult: async () => ({ status: 'merged' })
    },
    '../../src/utils/logger.js': {
      log: () => {}
    }
  });

  await siteCheckService.processPage(mockPage, mockProject, 'fr', null, {});
  assert.equal(updatedStatus, 'OK', 'Status should be OK if no PR was created');
});

test('siteCheckService - processPage handles analysis with PR and successful merge + fix', async (t) => {
  const statuses = [];
  const mockPage = { id: 1, url: '/test-page', requires_admin: 0, requires_auth: 0 };
  const mockProject = { id: 'project-1' };

  const siteCheckService = await esmock('../../src/services/siteCheckService.js', {
    '../../src/db/database.js': {
      updateSitePageResult: async (id, data) => {
        statuses.push(data.status);
      }
    },
    '../../src/api/julesClient.js': {
      startAndMonitorSession: async (prompt, name, project, options) => {
        if (name === 'Site-Check-Analysis') {
          options.onPRCreated({ prUrl: 'http://github.com/pr/1', prNumber: 1 });
          return true;
        }
        return true;
      }
    },
    '../../src/api/githubClient.js': {
      mergePRWithResult: async () => ({ status: 'merged' })
    },
    '../../src/utils/logger.js': {
      log: () => {}
    }
  });

  // Use a manual mock for setTimeout to speed up the test
  const originalTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => originalTimeout(fn, 0);

  try {
    await siteCheckService.processPage(mockPage, mockProject, 'fr', null, {});

    assert.ok(statuses.includes('ANALYZE'));
    assert.ok(statuses.includes('ANALYZED'));
    assert.ok(statuses.includes('FIX'));
  } finally {
    global.setTimeout = originalTimeout;
  }
});

test('siteCheckService - runSiteCheckCycle picks pages and processes them', async (t) => {
    let pickCalled = 0;
    const mockPage = { id: 1, url: '/test' };
    const mockProject = { id: 'p1' };

    const siteCheckService = await esmock('../../src/services/siteCheckService.js', {
        '../../src/db/database.js': {
            releaseStaleSitePageLocks: async () => {},
            pickAndLockSitePage: async () => {
                pickCalled++;
                return pickCalled === 1 ? mockPage : null;
            },
            updateSitePageResult: async () => {}
        },
        '../../src/api/julesClient.js': {
            startAndMonitorSession: async () => false
        },
        '../../src/utils/logger.js': {
            log: () => {}
        }
    });

    let stop = false;
    const shouldStop = () => stop;

    const originalTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => {
        if (ms === 60000) {
            stop = true;
            return originalTimeout(fn, 0);
        }
        return originalTimeout(fn, 1);
    };

    try {
        await siteCheckService.runSiteCheckCycle(mockProject, { shouldStop, pauseMs: 0 });
        assert.equal(pickCalled, 2, 'Should have called pick twice (one page, then empty)');
    } finally {
        global.setTimeout = originalTimeout;
    }
});
