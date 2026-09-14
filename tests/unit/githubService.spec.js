import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('githubService - getCachedPRs fetches and caches PRs', async () => {
    let callCount = 0;
    const mockPrs = [{ number: 1, title: 'Test PR' }];

    const githubService = await esmock('../../src/services/githubService.js', {
        '../../src/api/githubClient.js': {
            listOpenPRs: async () => {
                callCount++;
                return mockPrs;
            }
        }
    });

    const project = { id: 'test-project-vitest-new' };

    // First call - should fetch
    const prs1 = await githubService.getCachedPRs(project);
    expect(callCount).toBe(1);
    expect(prs1).toEqual(mockPrs);

    // Second call - should use cache
    const prs2 = await githubService.getCachedPRs(project);
    expect(callCount).toBe(1);
    expect(prs2).toEqual(mockPrs);
});

test('githubService - getCachedPRs deduplicates inflight requests', async () => {
    let callCount = 0;
    const githubService = await esmock('../../src/services/githubService.js', {
        '../../src/api/githubClient.js': {
            listOpenPRs: async () => {
                callCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
                return [{ number: 1 }];
            }
        }
    });

    const project = { id: 'test-project-inflight-vitest-new' };

    // Fire multiple requests simultaneously
    const [prs1, prs2] = await Promise.all([
        githubService.getCachedPRs(project),
        githubService.getCachedPRs(project)
    ]);

    expect(callCount).toBe(1);
    expect(prs1).toEqual(prs2);
});

test('githubService - invalidatePRCache clears the cache', async () => {
    let callCount = 0;
    const githubService = await esmock('../../src/services/githubService.js', {
        '../../src/api/githubClient.js': {
            listOpenPRs: async () => {
                callCount++;
                return [{ number: callCount }];
            }
        }
    });

    const project = { id: 'test-project-invalidate-vitest-new' };

    await githubService.getCachedPRs(project);
    expect(callCount).toBe(1);

    githubService.invalidatePRCache(project.id);

    await githubService.getCachedPRs(project);
    expect(callCount).toBe(2);
});

test('githubService - getCachedPRs cleans up inflight request on failure and allows retry', async () => {
    let callCount = 0;
    const githubService = await esmock('../../src/services/githubService.js', {
        '../../src/api/githubClient.js': {
            listOpenPRs: async () => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('GitHub API Temporary Error');
                }
                return [{ number: 99, title: 'Success after retry' }];
            }
        }
    });

    const project = { id: 'test-project-error-retry' };

    // First call - should fail and clean up inflight cache
    await expect(githubService.getCachedPRs(project)).rejects.toThrow('GitHub API Temporary Error');
    expect(callCount).toBe(1);

    // Second call - should retry fetching since inflight was deleted
    const prs = await githubService.getCachedPRs(project);
    expect(callCount).toBe(2);
    expect(prs).toEqual([{ number: 99, title: 'Success after retry' }]);
});

test('githubService - getCachedPRs refetches after TTL expiration', async () => {
    let callCount = 0;
    const githubService = await esmock('../../src/services/githubService.js', {
        '../../src/api/githubClient.js': {
            listOpenPRs: async () => {
                callCount++;
                return [{ number: callCount }];
            }
        }
    });

    const project = { id: 'test-project-ttl-expiration' };

    vi.useFakeTimers();
    try {
        const prs1 = await githubService.getCachedPRs(project);
        expect(callCount).toBe(1);
        expect(prs1).toEqual([{ number: 1 }]);

        // Advance time by 1 minute (within TTL of 2 minutes)
        vi.advanceTimersByTime(60 * 1000);
        const prsCached = await githubService.getCachedPRs(project);
        expect(callCount).toBe(1);
        expect(prsCached).toEqual([{ number: 1 }]);

        // Advance time past 2 minutes (TTL expired)
        vi.advanceTimersByTime(61 * 1000);
        const prsFresh = await githubService.getCachedPRs(project);
        expect(callCount).toBe(2);
        expect(prsFresh).toEqual([{ number: 2 }]);
    } finally {
        vi.useRealTimers();
    }
});
