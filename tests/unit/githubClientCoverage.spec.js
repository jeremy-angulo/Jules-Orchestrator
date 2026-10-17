import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../src/utils/helpers.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined)
}));

import {
  getNextGitHubIssue,
  closeGitHubIssue,
  checkAndMergePR,
  listOpenPRs,
  closePR,
  mergePRWithResult,
  getPRFiles,
  mergeOpenPRs
} from '../../src/api/githubClient.js';

describe('githubClient Coverage Expansion', () => {
  const mockProject = {
    id: 'proj-coverage',
    githubRepo: 'test-org/test-repo',
    githubToken: 'ghp_coverage_token'
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('githubRequest handling with null/undefined project', () => {
    it('should handle getNextGitHubIssue with null project fields or network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      const issue = await getNextGitHubIssue({ id: null, githubRepo: 'org/repo', githubToken: 'token' });
      expect(issue).toBeNull();
    });
  });

  describe('getNextGitHubIssue edge cases', () => {
    it('should return null when all open issues are pull requests', async () => {
      const mockIssues = [
        { id: 1, number: 10, title: 'PR 1', pull_request: {} },
        { id: 2, number: 11, title: 'PR 2', pull_request: {} }
      ];

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockIssues
      }));

      const issue = await getNextGitHubIssue(mockProject);
      expect(issue).toBeNull();
    });

    it('should return null when issue list is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => []
      }));

      const issue = await getNextGitHubIssue(mockProject);
      expect(issue).toBeNull();
    });

    it('should return null and log error when response is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Repository not found'
      }));

      const issue = await getNextGitHubIssue(mockProject);
      expect(issue).toBeNull();
    });

    it('should return issue when valid non-PR issue is returned', async () => {
      const mockIssues = [
        { id: 1, number: 10, title: 'PR 1', pull_request: {} },
        { id: 2, number: 12, title: 'Real Issue' }
      ];

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockIssues
      }));

      const issue = await getNextGitHubIssue(mockProject);
      expect(issue).toEqual({ id: 2, number: 12, title: 'Real Issue' });
    });
  });

  describe('closeGitHubIssue edge cases', () => {
    it('should resolve without error when issue is closed successfully', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      await closeGitHubIssue(mockProject, 42);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/issues/42',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should log error when API returns non-ok response on close issue', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
      vi.stubGlobal('fetch', fetchMock);

      await closeGitHubIssue(mockProject, 42);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('should handle network error on close issue gracefully', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network crash'));
      vi.stubGlobal('fetch', fetchMock);

      await closeGitHubIssue(mockProject, 42);
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('checkAndMergePR edge cases and state transitions', () => {
    it('should log error and exit early if getRes is not ok', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });
      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should exit early if PR is already merged', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ number: 5, merged: true })
      });
      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should exit early if PR title contains bump', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ number: 5, merged: false, title: 'bump dependencies' })
      });
      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should poll up to maxRetries when mergeable is null and give up', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ number: 5, merged: false, title: 'Feature', mergeable: null })
      });
      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 5);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('should handle PR with missing title gracefully during checkAndMergePR', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 15, merged: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 15);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should stop and return early when mergeable is false or mergeable_state is blocked', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 20, merged: false, mergeable: false, mergeable_state: 'dirty' })
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 20);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should poll multiple times when mergeable is null and proceed once mergeable becomes true', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 10, merged: false, title: 'Feature', mergeable: null })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 10, merged: false, title: 'Feature', mergeable: null })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 10, merged: false, title: 'Feature', mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 10);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('should handle 405 status on standard merge and retry with squash merge strategy successfully', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 30, merged: false, title: 'Feature', mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405,
          statusText: 'Method Not Allowed'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 30);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should log failure details when merge attempt fails completely and error text is present', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 40, merged: false, title: 'Feature', mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          text: async () => 'Branch protection conflict'
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 40);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should log failure details when merge attempt fails and reading error text throws', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 41, merged: false, title: 'Feature', mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          text: async () => { throw new Error('Stream read failed'); }
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 41);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should catch critical exception during checkAndMergePR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fatal network crash')));

      await checkAndMergePR(mockProject, 50);
    });
  });

  describe('listOpenPRs edge cases', () => {
    it('should map open PRs with individual PR details when response is ok', async () => {
      const mockList = [
        { number: 100, title: 'PR 100', user: { login: 'user1' }, head: { ref: 'feature' }, base: { ref: 'main' } }
      ];
      const mockDetail = {
        number: 100, title: 'PR 100', html_url: 'http://gh.com/pr/100', state: 'open', draft: false,
        merged: false, mergeable: true, mergeable_state: 'clean', created_at: '2025-01-01', updated_at: '2025-01-02',
        user: { login: 'user1', avatar_url: 'http://avatar' }, head: { ref: 'feature' }, base: { ref: 'main' },
        additions: 10, deletions: 2, changed_files: 3
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockList
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDetail
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await listOpenPRs(mockProject);
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual({
        number: 100,
        title: 'PR 100',
        html_url: 'http://gh.com/pr/100',
        state: 'open',
        draft: false,
        merged: false,
        mergeable: true,
        mergeable_state: 'clean',
        created_at: '2025-01-01',
        updated_at: '2025-01-02',
        user: { login: 'user1', avatar_url: 'http://avatar' },
        head: { ref: 'feature' },
        base: { ref: 'main' },
        additions: 10,
        deletions: 2,
        changed_files: 3
      });
    });

    it('should handle exception thrown during individual PR detail fetching and fall back gracefully', async () => {
      const mockList = [
        { number: 50, title: 'PR 50' }
      ];

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockList
        })
        .mockRejectedValueOnce(new Error('Detail fetch network error'));

      vi.stubGlobal('fetch', fetchMock);

      const res = await listOpenPRs(mockProject);
      expect(res).toHaveLength(1);
      expect(res[0].number).toBe(50);
      expect(res[0].additions).toBeNull();
    });

    it('should return empty array when initial list fetch fails with non-ok response', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await listOpenPRs(mockProject);
      expect(res).toEqual([]);
    });

    it('should return empty array when initial list fetch throws network error', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const res = await listOpenPRs(mockProject);
      expect(res).toEqual([]);
    });
  });

  describe('closePR helper', () => {
    it('should return true when API request succeeds', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await closePR(mockProject, 42);
      expect(result).toBe(true);
    });

    it('should return false when API returns error status', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await closePR(mockProject, 42);
      expect(result).toBe(false);
    });

    it('should return false when network exception occurs', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Connection lost'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await closePR(mockProject, 42);
      expect(result).toBe(false);
    });
  });

  describe('getPRFiles helper', () => {
    it('should return list of modified files when request succeeds', async () => {
      const mockFiles = [
        { filename: 'src/index.js', status: 'modified' },
        { filename: 'README.md', status: 'added' }
      ];
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockFiles
      });
      vi.stubGlobal('fetch', fetchMock);

      const files = await getPRFiles(mockProject, 15);
      expect(files).toEqual(mockFiles);
    });

    it('should return empty array when API response is not ok', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500
      });
      vi.stubGlobal('fetch', fetchMock);

      const files = await getPRFiles(mockProject, 15);
      expect(files).toEqual([]);
    });

    it('should return empty array when fetch throws network error', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const files = await getPRFiles(mockProject, 15);
      expect(files).toEqual([]);
    });
  });

  describe('mergePRWithResult edge cases and state branches', () => {
    it('should return failed status when getRes is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }));

      const res = await mergePRWithResult(mockProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'GitHub 404' });
    });

    it('should return skipped status when PR is already merged', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: true })
      }));

      const res = await mergePRWithResult(mockProject, 11);
      expect(res).toEqual({ status: 'skipped', reason: 'Already merged' });
    });

    it('should return skipped status when PR is closed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: false, state: 'closed' })
      }));

      const res = await mergePRWithResult(mockProject, 12);
      expect(res).toEqual({ status: 'skipped', reason: 'PR closed' });
    });

    it('should return failed status when PR is draft', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: true })
      }));

      const res = await mergePRWithResult(mockProject, 13);
      expect(res).toEqual({ status: 'failed', reason: 'Draft PR' });
    });

    it('should return failed status when mergeable is false with custom or fallback state', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: false, mergeable: false, mergeable_state: 'dirty' })
      }));

      const res = await mergePRWithResult(mockProject, 14);
      expect(res).toEqual({ status: 'failed', reason: 'Merge conflicts (dirty)' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: false, mergeable: false, mergeable_state: null })
      }));

      const res2 = await mergePRWithResult(mockProject, 14);
      expect(res2).toEqual({ status: 'failed', reason: 'Merge conflicts (dirty)' });
    });

    it('should return failed status when mergeable_state is blocked', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'blocked' })
      }));

      const res = await mergePRWithResult(mockProject, 15);
      expect(res).toEqual({ status: 'failed', reason: 'Blocked by branch protection' });
    });

    it('should return merged status when first merge strategy (merge) succeeds', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(mockProject, 16);
      expect(res).toEqual({ status: 'merged' });
    });

    it('should fallback to squash merge when first merge strategy returns 405, and succeed', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(mockProject, 17);
      expect(res).toEqual({ status: 'merged' });
    });

    it('should return failed status if both merge methods return 405', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(mockProject, 18);
      expect(res).toEqual({ status: 'failed', reason: 'Merge method not allowed' });
    });

    it('should handle 405 on first merge, attempt squash merge, fail with 400 and truncate error response text', async () => {
      const longText = 'E'.repeat(200);
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => longText
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(mockProject, 77);
      expect(res.status).toBe('failed');
      expect(res.reason).toBe(`400: ${'E'.repeat(120)}`);
    });

    it('should handle error when reading text fails during squash merge error handling', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => { throw new Error('Stream read failure'); }
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(mockProject, 88);
      expect(res.status).toBe('failed');
      expect(res.reason).toBe('500: ');
    });

    it('should handle non-Error exception string during mergePRWithResult', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('Fatal network crash string'));

      const res = await mergePRWithResult(mockProject, 99);
      expect(res.status).toBe('failed');
      expect(res.reason).toBe('Fatal network crash string');
    });

    it('should handle exception during initial merge failure error text stream reading', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          text: async () => { throw new Error('Text stream aborted'); }
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(mockProject, 101);
      expect(res.status).toBe('failed');
      expect(res.reason).toBe('409: ');
    });
  });

  describe('mergeOpenPRs parallel processing and edge cases', () => {
    it('should log error when list open PRs fetch fails', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        text: async () => 'Error fetching PRs'
      });
      vi.stubGlobal('fetch', fetchMock);

      await mergeOpenPRs(mockProject);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should return early if open PR list is empty', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });
      vi.stubGlobal('fetch', fetchMock);

      await mergeOpenPRs(mockProject);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should execute auto-merge in parallel for open PRs and skip bump PRs', async () => {
      const prs = [
        { number: 1, title: 'bump dependencies' },
        { number: 2, title: 'Fix bug A' },
        { number: 3, title: 'Add feature B' }
      ];

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => prs
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 2, merged: true, title: 'Fix bug A' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 3, merged: true, title: 'Add feature B' })
        });

      vi.stubGlobal('fetch', fetchMock);

      await mergeOpenPRs(mockProject);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should catch critical error during mergeOpenPRs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fatal mergeOpenPRs error')));

      await mergeOpenPRs(mockProject);
    });
  });
});
