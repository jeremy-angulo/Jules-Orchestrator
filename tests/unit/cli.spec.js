import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';

describe('cli.js', () => {
  let logSpy, errorSpy, exitSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('should print usage help on unknown command', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'help']
    });

    await esmock('../../src/cli.js', {
      '../../src/db/database.js': {
        listAgents: vi.fn(async () => [])
      }
    });

    expect(logSpy).toHaveBeenCalledWith('Usage: node src/cli.js <launch|cleanup|list-agents> [params]');
  });

  it('list-agents - should list DB and FS agents', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'list-agents']
    });

    const mockListAgents = vi.fn(async () => [
      { name: 'DbAgent1', description: 'DB agent', prompt: 'db-prompt' }
    ]);

    const mockReaddirSync = vi.fn(() => ['fs-agent.md']);
    const mockReadFileSync = vi.fn(() => 'fs-prompt');

    await esmock('../../src/cli.js', {
      '../../src/db/database.js': {
        listAgents: mockListAgents
      },
      'fs': {
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync
      }
    });

    expect(mockListAgents).toHaveBeenCalled();
    expect(mockReaddirSync).toHaveBeenCalledWith('./prompts/HomeFreeWorld');
    expect(mockReadFileSync).toHaveBeenCalledWith('prompts/HomeFreeWorld/fs-agent.md', 'utf8');

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([
      { name: 'DbAgent1', description: 'DB agent' },
      { name: 'fs-agent', description: 'Filesystem agent: fs-agent' }
    ]);
  });

  it('cleanup - should parse sessions and perform cleanups', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'cleanup']
    });

    const mockListAgents = vi.fn(async () => []);
    const mockReaddirSync = vi.fn(() => []);

    const mockExecSync = vi.fn((cmd) => {
      if (cmd.includes('jules remote list')) {
        return `
ID                     DESCRIPTION                     REPO                     LAST ACTIVE                     STATUS
s1                     lead-sdet                       repo                     time                            Awaiting User
s2                     sentinel                        repo                     time                            Completed
s3                     bolt                            repo                     time                            Running
`;
      }
      return '';
    });

    const mockApprovePlan = vi.fn(async () => {});
    const mockSendMessage = vi.fn(async () => {});
    const mockDeleteSession = vi.fn(async () => {});
    const mockRecordAgentSessionEnd = vi.fn(async () => {});

    await esmock('../../src/cli.js', {
      '../../src/db/database.js': {
        listAgents: mockListAgents,
        recordAgentSessionEnd: mockRecordAgentSessionEnd
      },
      '../../src/api/julesClient.js': {
        approvePlan: mockApprovePlan,
        sendMessage: mockSendMessage,
        deleteSession: mockDeleteSession
      },
      'child_process': {
        execSync: mockExecSync
      },
      'fs': {
        readdirSync: mockReaddirSync
      }
    });

    expect(mockExecSync).toHaveBeenCalledWith('jules remote list --session', { encoding: 'utf8' });

    // s1 is Awaiting User (should approvePlan and sendMessage)
    expect(mockApprovePlan).toHaveBeenCalledWith('lead-sdet', 'sessions/s1');
    expect(mockSendMessage).toHaveBeenCalledWith('lead-sdet', 'sessions/s1', 'keep going');

    // s2 is Completed (should deleteSession and recordAgentSessionEnd)
    expect(mockDeleteSession).toHaveBeenCalledWith('sentinel', 'sessions/s2');
    expect(mockRecordAgentSessionEnd).toHaveBeenCalledWith('sessions/s2', 'archived');

    // Stats output summary
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- Active: 1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- Sent "keep going": 1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- Archived: 1'));
  });

  it('cleanup - handles errors gracefully during session cleanup operations', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'cleanup']
    });

    const mockExecSync = vi.fn(() => `
ID                     DESCRIPTION                     REPO                     LAST ACTIVE                     STATUS
s1                     lead-sdet                       repo                     time                            Awaiting User
s2                     sentinel                        repo                     time                            Completed
`);

    // Force error throws
    const mockApprovePlan = vi.fn(async () => {});
    const mockSendMessage = vi.fn(async () => { throw new Error('Send fail'); });
    const mockDeleteSession = vi.fn(async () => { throw new Error('Delete fail'); });

    await esmock('../../src/cli.js', {
      '../../src/db/database.js': {
        listAgents: vi.fn(async () => []),
        recordAgentSessionEnd: vi.fn(async () => {})
      },
      '../../src/api/julesClient.js': {
        approvePlan: mockApprovePlan,
        sendMessage: mockSendMessage,
        deleteSession: mockDeleteSession
      },
      'child_process': {
        execSync: mockExecSync
      },
      'fs': {
        readdirSync: vi.fn(() => [])
      }
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to message session s1: Send fail'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to archive session s2: Delete fail'));
  });

  it('launch - prints error if agent is not found', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'launch', 'nonexistent-agent', '.']
    });

    exitSpy.mockImplementation(() => { throw new Error('exit'); });

    await expect(
      esmock('../../src/cli.js', {
        '../../src/db/database.js': {
          listAgents: vi.fn(async () => [])
        },
        'fs': {
          readdirSync: vi.fn(() => [])
        }
      })
    ).rejects.toThrow('exit');

    expect(errorSpy).toHaveBeenCalledWith('Error: Agent "nonexistent-agent" not found.');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('launch - launches jules task when agent is found', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'launch', 'lead-sdet', 'test-repo', 'write integration tests']
    });

    const mockListAgents = vi.fn(async () => [
      { name: 'lead-sdet', prompt: 'SDET prompt instructions' }
    ]);

    const mockExecSync = vi.fn();

    await esmock('../../src/cli.js', {
      '../../src/db/database.js': {
        listAgents: mockListAgents
      },
      'child_process': {
        execSync: mockExecSync
      },
      'fs': {
        readdirSync: vi.fn(() => [])
      }
    });

    expect(logSpy).toHaveBeenCalledWith('Launching agent: lead-sdet...');

    // Check command with task prepended
    const expectedCommand = `jules new --repo test-repo "TASK: write integration tests\n\nROLE CONTEXT:\nSDET prompt instructions"`;
    expect(mockExecSync).toHaveBeenCalledWith(expectedCommand, { encoding: 'utf8' });
  });

  it('launch - handles execution failure gracefully', async () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'src/cli.js', 'launch', 'lead-sdet', '.', 'fail task']
    });

    const mockListAgents = vi.fn(async () => [
      { name: 'lead-sdet', prompt: 'SDET prompt' }
    ]);

    const mockExecSync = vi.fn(() => { throw new Error('Exec failed'); });

    await esmock('../../src/cli.js', {
      '../../src/db/database.js': {
        listAgents: mockListAgents
      },
      'child_process': {
        execSync: mockExecSync
      },
      'fs': {
        readdirSync: vi.fn(() => [])
      }
    });

    expect(errorSpy).toHaveBeenCalledWith('Failed to launch Jules: Exec failed');
  });
});
