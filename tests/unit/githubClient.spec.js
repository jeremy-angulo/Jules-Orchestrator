import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

describe('githubClient API Service', () => {
  const dummyProject = {
    id: 'proj-123',
    githubRepo: 'owner/repo',
    githubToken: 'ghp_token123'
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('getNextGitHubIssue', () => {
    it('should fetch open issues and return the first non-pull request issue', async () => {
      const mockIssues = [
        { id: 1, number: 10, title: 'PR 1', pull_request: {} },
        { id: 2, number: 11, title: 'Real Issue', state: 'open' }
      ];

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockIssues
      }));

      const issue = await getNextGitHubIssue(dummyProject);
      expect(issue).toEqual(mockIssues[1]);
    });

    it('should return null if API response is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Repository not found'
      }));

      const issue = await getNextGitHubIssue(dummyProject);
      expect(issue).toBeNull();
    });

    it('should return null and log on network throw (including missing project fields)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const projectWithoutInfo = {};
      const issue = await getNextGitHubIssue(projectWithoutInfo);
      expect(issue).toBeNull();
    });

    it('should handle exception with non-standard error object', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('Custom string error'));

      const issue = await getNextGitHubIssue(dummyProject);
      expect(issue).toBeNull();
    });
  });

  describe('closeGitHubIssue', () => {
    it('should successfully close an issue', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      });
      vi.stubGlobal('fetch', fetchMock);

      await closeGitHubIssue(dummyProject, 42);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed' })
        })
      );
    });

    it('should log error when close issue fails with non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      }));

      await closeGitHubIssue(dummyProject, 42);
    });

    it('should handle network error on close issue', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection lost')));

      await closeGitHubIssue(dummyProject, 42);
    });
  });

  describe('checkAndMergePR', () => {
    it('should stop polling and return if PR is already merged', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ merged: true, number: 5 })
      }));

      await checkAndMergePR(dummyProject, 5);
    });

    it('should skip if PR title includes "bump"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ merged: false, title: 'bump version 1.0.1' })
      }));

      await checkAndMergePR(dummyProject, 5);
    });

    it('should handle get PR failure and return early', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error'
      }));

      await checkAndMergePR(dummyProject, 5);
    });

    it('should retry polling when mergeable is null and give up after max retries', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ merged: false, mergeable: null })
      }));

      await checkAndMergePR(dummyProject, 5);
    });

    it('should stop if mergeable is false or mergeable_state is blocked', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ merged: false, mergeable: false, mergeable_state: 'dirty' })
      }));

      await checkAndMergePR(dummyProject, 5);
    });

    it('should attempt merge method and log success on ok response', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ merged: false, mergeable: true, mergeable_state: 'clean' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(dummyProject, 5);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should fallback to squash merge if classic merge returns 405', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ merged: false, mergeable: true, mergeable_state: 'clean' })
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

      await checkAndMergePR(dummyProject, 5);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should log failure details when merge attempt fails completely', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ merged: false, mergeable: true })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          text: async () => 'Base branch modified'
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(dummyProject, 5);
    });

    it('should handle failure text reading error gracefully', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ merged: false, mergeable: true })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          text: async () => { throw new Error('Stream closed'); }
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(dummyProject, 5);
    });

    it('should catch critical exceptions during checkAndMergePR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fatal error')));

      await checkAndMergePR(dummyProject, 5);
    });
  });

  describe('listOpenPRs', () => {
    it('should return empty array if initial PR list fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const res = await listOpenPRs(dummyProject);
      expect(res).toEqual([]);
    });

    it('should return detailed PR objects including additions/deletions/user info', async () => {
      const mockList = [
        {
          number: 101,
          title: 'PR 101',
          html_url: 'http://github.com/101',
          state: 'open',
          draft: false,
          user: { login: 'alice', avatar_url: 'http://avatar.com/a' },
          head: { ref: 'feature-a' },
          base: { ref: 'main' }
        }
      ];

      const mockDetail = {
        ...mockList[0],
        merged: false,
        mergeable: true,
        mergeable_state: 'clean',
        additions: 10,
        deletions: 5,
        changed_files: 2
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

      const res = await listOpenPRs(dummyProject);
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual(expect.objectContaining({
        number: 101,
        additions: 10,
        deletions: 5,
        changed_files: 2
      }));
    });

    it('should fallback to base PR object if detailed PR fetch fails or throws', async () => {
      const mockList = [
        { number: 101, title: 'PR 101' },
        { number: 102, title: 'PR 102' }
      ];

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockList
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        })
        .mockRejectedValueOnce(new Error('Timeout'));

      vi.stubGlobal('fetch', fetchMock);

      const res = await listOpenPRs(dummyProject);
      expect(res).toHaveLength(2);
      expect(res[0].additions).toBeNull();
      expect(res[1].deletions).toBeNull();
    });

    it('should return empty array on outer exception', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fatal list PR error')));

      const res = await listOpenPRs(dummyProject);
      expect(res).toEqual([]);
    });

    it('should safely map PRs when user, head, base or counts are undefined or null', async () => {
      const mockList = [{ number: 201, title: 'Incomplete PR' }];
      const mockDetail = { number: 201, title: 'Incomplete PR' };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => mockList })
        .mockResolvedValueOnce({ ok: true, json: async () => mockDetail });

      vi.stubGlobal('fetch', fetchMock);

      const res = await listOpenPRs(dummyProject);
      expect(res).toHaveLength(1);
      expect(res[0].user).toEqual({ login: undefined, avatar_url: undefined });
      expect(res[0].head).toEqual({ ref: undefined });
      expect(res[0].base).toEqual({ ref: undefined });
      expect(res[0].additions).toBeNull();
      expect(res[0].deletions).toBeNull();
      expect(res[0].changed_files).toBeNull();
    });
  });

  describe('closePR', () => {
    it('should return true when PR is successfully closed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const success = await closePR(dummyProject, 12);
      expect(success).toBe(true);
    });

    it('should return false when PR close response is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const success = await closePR(dummyProject, 12);
      expect(success).toBe(false);
    });

    it('should return false on exception', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Close error')));

      const success = await closePR(dummyProject, 12);
      expect(success).toBe(false);
    });
  });

  describe('mergePRWithResult', () => {
    it('should return failed if get PR fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'GitHub 404' });
    });

    it('should return skipped if already merged', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ merged: true })
      }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'skipped', reason: 'Already merged' });
    });

    it('should return skipped if PR state is closed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ merged: false, state: 'closed' })
      }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'skipped', reason: 'PR closed' });
    });

    it('should return failed if PR is draft', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: true })
      }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'Draft PR' });
    });

    it('should return failed if mergeable is false with dirty or custom state', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: false, mergeable: false, mergeable_state: 'dirty' })
      }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'Merge conflicts (dirty)' });
    });

    it('should return failed if mergeable is false with missing mergeable_state', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: false, mergeable: false })
      }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'Merge conflicts (dirty)' });
    });

    it('should return failed if mergeable_state is blocked', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'blocked' })
      }));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'Blocked by branch protection' });
    });

    it('should return merged when merge succeeds on first attempt', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true })
        })
        .mockResolvedValueOnce({
          ok: true
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'merged' });
    });

    it('should return failed with truncated reason if merge fails with non-405 status', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          text: async () => 'Head branch was modified'
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: '409: Head branch was modified' });
    });

    it('should handle text reading exception on non-405 failure', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => { throw new Error('Stream error'); }
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: '500: ' });
    });

    it('should try squash method if merge method returns 405', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 405
        })
        .mockResolvedValueOnce({
          ok: true
        });

      vi.stubGlobal('fetch', fetchMock);

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'merged' });
    });

    it('should return "Merge method not allowed" if both merge methods return 405', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: false, state: 'open', draft: false, mergeable: true })
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

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'Merge method not allowed' });
    });

    it('should return failed with error message on exception', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unhandled exception')));

      const res = await mergePRWithResult(dummyProject, 10);
      expect(res).toEqual({ status: 'failed', reason: 'Unhandled exception' });
    });
  });

  describe('getPRFiles', () => {
    it('should return array of files on success', async () => {
      const files = [{ filename: 'src/app.js' }, { filename: 'package.json' }];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => files
      }));

      const res = await getPRFiles(dummyProject, 10);
      expect(res).toEqual(files);
    });

    it('should return empty array if res is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const res = await getPRFiles(dummyProject, 10);
      expect(res).toEqual([]);
    });

    it('should return empty array on exception', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Files error')));

      const res = await getPRFiles(dummyProject, 10);
      expect(res).toEqual([]);
    });
  });

  describe('mergeOpenPRs', () => {
    it('should log error if fetching open PRs fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Error fetching PRs'
      }));

      await mergeOpenPRs(dummyProject);
    });

    it('should return early if PR list is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => []
      }));

      await mergeOpenPRs(dummyProject);
    });

    it('should process open PRs and skip PRs with "bump" in title', async () => {
      const prs = [
        { number: 1, title: 'bump version' },
        { number: 2, title: 'Fix bug' }
      ];

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => prs
        })
        // checkAndMergePR for PR #2:
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ merged: true, number: 2 })
        });

      vi.stubGlobal('fetch', fetchMock);

      await mergeOpenPRs(dummyProject);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should catch critical errors in mergeOpenPRs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fatal mergeOpenPRs error')));

      await mergeOpenPRs(dummyProject);
    });
  });
});
