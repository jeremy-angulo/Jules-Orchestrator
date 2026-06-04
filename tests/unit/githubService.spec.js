import { test, expect } from 'vitest';
import esmock from 'esmock';

test('githubService - getCachedPRs fetches and caches PRs (Vitest)', async () => {
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

    const project = { id: 'test-project-vitest' };

    // First call - should fetch
    const prs1 = await githubService.getCachedPRs(project);
    expect(callCount).toBe(1);
    expect(prs1).toEqual(mockPrs);

    // Second call - should use cache
    const prs2 = await githubService.getCachedPRs(project);
    expect(callCount).toBe(1);
    expect(prs2).toEqual(mockPrs);
});

test('githubService - getCachedPRs deduplicates inflight requests (Vitest)', async () => {
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

    const project = { id: 'test-project-inflight-vitest' };

    // Fire multiple requests simultaneously
    const [prs1, prs2] = await Promise.all([
        githubService.getCachedPRs(project),
        githubService.getCachedPRs(project)
    ]);

    expect(callCount).toBe(1);
    expect(prs1).toEqual(prs2);
});

test('githubService - invalidatePRCache clears the cache (Vitest)', async () => {
    let callCount = 0;
    const githubService = await esmock('../../src/services/githubService.js', {
        '../../src/api/githubClient.js': {
            listOpenPRs: async () => {
                callCount++;
                return [{ number: callCount }];
            }
        }
    });

    const project = { id: 'test-project-invalidate-vitest' };

    await githubService.getCachedPRs(project);
    expect(callCount).toBe(1);

    githubService.invalidatePRCache(project.id);

    await githubService.getCachedPRs(project);
    expect(callCount).toBe(2);
});
