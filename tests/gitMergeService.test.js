import test from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';

const mockProject = {
  id: 'test-project',
  githubToken: 'test-token',
  githubRepo: 'owner/repo'
};

test('attemptMechanicalMerge - success without conflicts', async () => {
  let execCommands = [];
  const { attemptMechanicalMerge } = await esmock('../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        execCommands.push(cmd);
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: async () => '/tmp/mock-dir',
      rm: async () => {},
      readFile: async () => '',
      writeFile: async () => {}
    },
    '../src/utils/logger.js': {
      log: () => {}
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  assert.strictEqual(result, true);
  assert.ok(execCommands.some(c => c.includes('git clone')));
  assert.ok(execCommands.some(c => c.includes('gh pr checkout 123')));
  assert.ok(execCommands.some(c => c.includes('git merge origin/main')));
});

test('attemptMechanicalMerge - success with mechanical resolution', async () => {
  let execCommands = [];
  let writtenFiles = {};
  const { attemptMechanicalMerge } = await esmock('../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        execCommands.push(cmd);
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else if (cmd.includes('git merge')) {
          // Simulate conflict
          const err = new Error('Conflict');
          err.code = 1;
          callback(err, { stdout: '', stderr: 'CONFLICT' });
        } else if (cmd.includes('git diff --name-only')) {
          callback(null, { stdout: 'README.md\npackage.json\n' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: async () => '/tmp/mock-dir',
      rm: async () => {},
      readFile: async (path) => {
        if (path.endsWith('README.md')) return '<<<<<<< HEAD\nbase\n=======\ndev\n>>>>>>> dev';
        if (path.endsWith('package.json')) return '{"a": 1}';
        return '';
      },
      writeFile: async (path, content) => {
        writtenFiles[path] = content;
      }
    },
    '../src/utils/mdConflictResolver.js': {
      resolveMarkdownConflict: (c) => 'resolved-md'
    },
    '../src/utils/jsonConflictResolver.js': {
      resolveJsonConflict: (c) => 'resolved-json'
    },
    '../src/utils/logger.js': {
      log: () => {}
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  assert.strictEqual(result, true);
  assert.ok(execCommands.some(c => c.includes('git add README.md')));
  assert.ok(execCommands.some(c => c.includes('git add package.json')));
  const mdFile = Object.keys(writtenFiles).find(k => k.endsWith('README.md'));
  assert.strictEqual(writtenFiles[mdFile], 'resolved-md');
});

test('attemptMechanicalMerge - failure with unsupported files', async () => {
  const { attemptMechanicalMerge } = await esmock('../src/services/gitMergeService.js', {
    'child_process': {
      exec: (cmd, options, callback) => {
        if (cmd.includes('gh pr view')) {
          callback(null, { stdout: JSON.stringify({ baseRefName: 'main' }) });
        } else if (cmd.includes('git merge')) {
          const err = new Error('Conflict');
          callback(err, { stdout: '' });
        } else if (cmd.includes('git diff --name-only')) {
          callback(null, { stdout: 'src/app.js\n' });
        } else {
          callback(null, { stdout: '' });
        }
      }
    },
    'fs/promises': {
      mkdtemp: async () => '/tmp/mock-dir',
      rm: async () => {}
    },
    '../src/utils/logger.js': {
      log: () => {}
    }
  });

  const result = await attemptMechanicalMerge(mockProject, 123);
  assert.strictEqual(result, false);
});
