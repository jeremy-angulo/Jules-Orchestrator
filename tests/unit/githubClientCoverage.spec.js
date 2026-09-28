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
