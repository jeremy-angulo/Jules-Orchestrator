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

test('gitMergeService - successful mechanical merge with no conflicts', async () => {
  const executedCommands = [];
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        executedCommands.push(cmd);
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir-success'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(true);

  // Verify expected sequence of commands
  expect(executedCommands[0]).toContain('git clone');
  expect(executedCommands[1]).toContain('gh pr checkout 123');
  expect(executedCommands[2]).toContain('gh pr view 123 --json baseRefName');
  expect(executedCommands[3]).toContain('git merge origin/main');
  expect(executedCommands[4]).toContain('git push origin HEAD');
  expect(executedCommands[5]).toContain('gh pr merge 123 --merge');
});

test('gitMergeService - successful mechanical merge with conflict resolution', async () => {
  const executedCommands = [];
  const readFiles = [];
  const writtenFiles = {};

  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        executedCommands.push(cmd);
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else if (cmd.includes('git merge')) {
          // Simulate conflict on merge
          callback(new Error('merge failed with conflicts'), { stderr: 'CONFLICT (content): Merge conflict' });
        } else if (cmd.includes('git diff --name-only --diff-filter=U')) {
          callback(null, { stdout: 'file1.md\nfile2.json\n' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir-conflict'),
      rm: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation(async (filePath) => {
        readFiles.push(filePath);
        if (filePath.endsWith('.json')) {
          return '{\n<<<<<<< HEAD\n"a": 1\n=======\n"a": 2\n>>>>>>> origin/main\n}';
        }
        return '# Header\n<<<<<<< HEAD\ntextA\n=======\ntextB\n>>>>>>> origin/main\n';
      }),
      writeFile: vi.fn().mockImplementation(async (filePath, content) => {
        writtenFiles[filePath] = content;
      })
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(true);

  // Commands should include handling conflicts
  expect(executedCommands).toContain('git diff --name-only --diff-filter=U');
  expect(executedCommands).toContain('git add file1.md');
  expect(executedCommands).toContain('git add file2.json');
  expect(executedCommands).toContain('git commit -m "chore: auto-resolve markdown and json conflicts"');
  expect(executedCommands).toContain('git push origin HEAD');
  expect(executedCommands).toContain('gh pr merge 123 --merge');

  // Verify file resolution
  expect(readFiles).toContain('/tmp/mock-dir-conflict/file1.md');
  expect(readFiles).toContain('/tmp/mock-dir-conflict/file2.json');

  expect(writtenFiles['/tmp/mock-dir-conflict/file1.md']).not.toContain('<<<<<<<');
  expect(writtenFiles['/tmp/mock-dir-conflict/file2.json']).not.toContain('<<<<<<<');
});

test('gitMergeService - aborts mechanical merge if there is an unsupported conflict file', async () => {
  const executedCommands = [];
  const { attemptMechanicalMerge } = await esmock('../../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        executedCommands.push(cmd);
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else if (cmd.includes('git merge')) {
          callback(new Error('merge failed with conflicts'), { stderr: 'CONFLICT' });
        } else if (cmd.includes('git diff --name-only --diff-filter=U')) {
          callback(null, { stdout: 'file1.js\n' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-dir-js-conflict'),
      rm: vi.fn().mockResolvedValue(undefined)
    },
    '../../src/utils/logger.js': {
      log: vi.fn()
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  expect(result).toBe(false);

  // Verify that it aborted before trying to resolve or push
  expect(executedCommands).not.toContain('git add file1.js');
  expect(executedCommands).not.toContain('git push origin HEAD');
});
