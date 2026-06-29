import { test, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

const mockProject = {
    id: 'test-project',
    githubRepo: 'test/repo',
    githubToken: 'fake-token'
};

const setupGithubClient = async (mocks = {}) => {
    return await esmock('../../src/api/githubClient.js', {
        '../../src/utils/logger.js': {
            log: vi.fn()
        },
        '../../src/utils/helpers.js': {
            sleep: vi.fn(async () => Promise.resolve())
        },
        '../../src/services/metricsStore.js': {
            recordServiceCheck: vi.fn(),
            recordServiceError: vi.fn()
        },
        ...mocks
    });
};

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

test('getNextGitHubIssue - success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => [{ number: 1, title: 'Test Issue' }, { number: 2, title: 'PR', pull_request: {} }]
    })));

    const githubClient = await setupGithubClient();
    const issue = await githubClient.getNextGitHubIssue(mockProject);
    expect(issue).toEqual({ number: 1, title: 'Test Issue' });
});

test('getNextGitHubIssue - returns null if only pull requests exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => [{ number: 1, title: 'PR 1', pull_request: {} }]
    })));

    const githubClient = await setupGithubClient();
    const issue = await githubClient.getNextGitHubIssue(mockProject);
    expect(issue).toBeNull();
});

test('getNextGitHubIssue - handles not ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'error text'
    })));

    const githubClient = await setupGithubClient();
    const issue = await githubClient.getNextGitHubIssue(mockProject);
    expect(issue).toBeNull();
});

test('getNextGitHubIssue - handles network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network failure'); }));

    const githubClient = await setupGithubClient();
    const issue = await githubClient.getNextGitHubIssue(mockProject);
    expect(issue).toBeNull();
});

test('closeGitHubIssue - success', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    await githubClient.closeGitHubIssue(mockProject, 123);

    expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test/repo/issues/123',
        expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ state: 'closed' })
        })
    );
});

test('closeGitHubIssue - handles network error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network failure'); }));

    const githubClient = await setupGithubClient();
    // Should not throw
    await expect(githubClient.closeGitHubIssue(mockProject, 123)).resolves.not.toThrow();
});

test('closeGitHubIssue - handles API error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
    })));

    const githubClient = await setupGithubClient();
    await expect(githubClient.closeGitHubIssue(mockProject, 123)).resolves.not.toThrow();
});

test('checkAndMergePR - skips bump PRs', async () => {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ number: 123, title: 'chore: bump version', merged: false, mergeable: true })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    await githubClient.checkAndMergePR(mockProject, 123);

    // Should fetch once then return without merging
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/merge'), expect.anything());
});

test('checkAndMergePR - polls for mergeable state and merges', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (url) => {
        if (url.endsWith('/pulls/123')) {
            callCount++;
            if (callCount === 1) return { ok: true, json: async () => ({ number: 123, mergeable: null }) };
            return { ok: true, json: async () => ({ number: 123, mergeable: true }) };
        }
        if (url.endsWith('/merge')) return { ok: true };
        return { ok: false };
    });
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    await githubClient.checkAndMergePR(mockProject, 123);

    expect(callCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/merge'), expect.objectContaining({ method: 'PUT' }));
});

test('checkAndMergePR - retries with squash on 405', async () => {
    const fetchMock = vi.fn(async (url, options) => {
        if (url.endsWith('/pulls/123')) return { ok: true, json: async () => ({ number: 123, mergeable: true }) };
        if (url.endsWith('/merge')) {
            const body = JSON.parse(options.body);
            if (body.merge_method === 'merge') return { ok: false, status: 405 };
            if (body.merge_method === 'squash') return { ok: true };
        }
        return { ok: false };
    });
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    await githubClient.checkAndMergePR(mockProject, 123);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/merge'), expect.objectContaining({
        body: expect.stringContaining('"merge_method":"merge"')
    }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/merge'), expect.objectContaining({
        body: expect.stringContaining('"merge_method":"squash"')
    }));
});

test('listOpenPRs - fetches list and details', async () => {
    const fetchMock = vi.fn(async (url) => {
        if (url.includes('/pulls?state=open')) {
            return { ok: true, json: async () => [{ number: 1, title: 'PR 1' }] };
        }
        if (url.includes('/pulls/1')) {
            return { ok: true, json: async () => ({ number: 1, title: 'PR 1', mergeable: true, mergeable_state: 'clean' }) };
        }
        return { ok: false };
    });
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    const prs = await githubClient.listOpenPRs(mockProject);

    expect(prs).toHaveLength(1);
    expect(prs[0].mergeable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('mergePRWithResult - success', async () => {
    const fetchMock = vi.fn(async (url) => {
        if (url.endsWith('/pulls/1')) return { ok: true, json: async () => ({ number: 1, mergeable: true, state: 'open' }) };
        if (url.endsWith('/merge')) return { ok: true };
        return { ok: false };
    });
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    const result = await githubClient.mergePRWithResult(mockProject, 1);
    expect(result.status).toBe('merged');
});

test('mergePRWithResult - conflict', async () => {
    const fetchMock = vi.fn(async (url) => {
        if (url.endsWith('/pulls/1')) return { ok: true, json: async () => ({ number: 1, mergeable: false, state: 'open', mergeable_state: 'dirty' }) };
        return { ok: false };
    });
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    const result = await githubClient.mergePRWithResult(mockProject, 1);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Merge conflicts');
});

test('getPRFiles - success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => [{ filename: 'test.js' }]
    })));

    const githubClient = await setupGithubClient();
    const files = await githubClient.getPRFiles(mockProject, 1);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('test.js');
});

test('mergeOpenPRs - calls checkAndMergePR for each open PR', async () => {
    const fetchMock = vi.fn(async (url) => {
        if (url.includes('/pulls?state=open')) return { ok: true, json: async () => [{ number: 1, title: 'PR 1' }, { number: 2, title: 'bump version' }] };
        if (url.includes('/pulls/')) return { ok: true, json: async () => ({ number: 1, mergeable: true }) };
        if (url.endsWith('/merge')) return { ok: true };
        return { ok: false };
    });
    vi.stubGlobal('fetch', fetchMock);

    const githubClient = await setupGithubClient();
    await githubClient.mergeOpenPRs(mockProject);

    // Should call fetch for PR 1 (details + merge) but not merge for PR 2 (bump)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/pulls/1'), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/pulls/2/merge'), expect.anything());
});
