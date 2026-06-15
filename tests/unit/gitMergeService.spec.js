import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

const mockProject = {
  id: 'test-project',
  githubToken: 'test-token',
  githubRepo: 'owner/repo'
};

test('gitMergeService - fails if mkdtemp fails', async () => {
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'fs/promises': {
      mkdtemp: vi.fn().mockRejectedValue(new Error('mkdtemp failed')),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);
});

test('gitMergeService - fails if git clone fails', async () => {
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        if (cmd.includes('git clone')) {
          callback(new Error('clone failed'), { stderr: 'fatal: repository not found' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);
});

test('gitMergeService - fails if gh pr checkout fails', async () => {
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        if (cmd.includes('git clone')) {
          callback(null, { stdout: '' });
        } else if (cmd.includes('gh pr checkout')) {
          callback(new Error('checkout failed'), { stderr: 'error: pr not found' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);
});

test('gitMergeService - fails if gh pr view fails', async () => {
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        if (cmd.includes('gh pr view')) {
          callback(new Error('view failed'), { stderr: 'error' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);
});

test('gitMergeService - fails if git push fails', async () => {
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else if (cmd.includes('git push')) {
          callback(new Error('push failed'), { stderr: 'error' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);
});

test('gitMergeService - fails if gh pr merge fails', async () => {
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else if (cmd.includes('gh pr merge')) {
          callback(new Error('merge failed'), { stderr: 'error' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);
});
