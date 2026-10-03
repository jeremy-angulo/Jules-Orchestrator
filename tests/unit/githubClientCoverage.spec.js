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

  describe('checkAndMergePR polling state transitions', () => {
    it('should poll multiple times when mergeable is null and proceed once mergeable becomes true', async () => {
      const fetchMock = vi.fn()
        // Iteration 1: null mergeable
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 10, merged: false, title: 'Feature', mergeable: null })
        })
        // Iteration 2: null mergeable
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 10, merged: false, title: 'Feature', mergeable: null })
        })
        // Iteration 3: true mergeable, clean state
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 10, merged: false, title: 'Feature', mergeable: true, mergeable_state: 'clean' })
        })
        // Merge request success
        .mockResolvedValueOnce({
          ok: true,
          status: 200
        });

      vi.stubGlobal('fetch', fetchMock);

      await checkAndMergePR(mockProject, 10);

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('listOpenPRs edge cases', () => {
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
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/pulls/42',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer ghp_coverage_token'
          }),
          body: JSON.stringify({ state: 'closed' })
        })
      );
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
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-org/test-repo/pulls/15/files?per_page=100',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ghp_coverage_token'
          })
        })
      );
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

  describe('mergePRWithResult fallback and error handling', () => {
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
      expect(res.reason).toBeUndefined();
    });
  });

  describe('mergeOpenPRs parallel processing', () => {
    it('should execute auto-merge in parallel for open PRs and skip bump PRs', async () => {
      const prs = [
        { number: 1, title: 'bump dependencies' },
        { number: 2, title: 'Fix bug A' },
        { number: 3, title: 'Add feature B' }
      ];

      const fetchMock = vi.fn()
        // PR list
        .mockResolvedValueOnce({
          ok: true,
          json: async () => prs
        })
        // PR #2 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 2, merged: true, title: 'Fix bug A' })
        })
        // PR #3 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ number: 3, merged: true, title: 'Add feature B' })
        });

      vi.stubGlobal('fetch', fetchMock);

      await mergeOpenPRs(mockProject);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
