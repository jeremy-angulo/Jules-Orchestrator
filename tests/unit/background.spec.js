import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('background.js', () => {
    let backgroundAgent;
    let mockSleep;
    let mockIsLocked;
    let mockIncrement;
    let mockDecrement;
    let mockStartSession;
    let mockLog;

    beforeEach(async () => {
        mockSleep = vi.fn().mockResolvedValue(undefined);
        mockIsLocked = vi.fn().mockResolvedValue(false);
        mockIncrement = vi.fn();
        mockDecrement = vi.fn();
        mockStartSession = vi.fn();
        mockLog = vi.fn();

        backgroundAgent = await esmock('../../src/agents/background.js', {
            '../../src/utils/helpers.js': { sleep: mockSleep },
            '../../src/api/julesClient.js': { startAndMonitorSession: mockStartSession },
            '../../src/db/database.js': {
                isProjectLocked: mockIsLocked,
                incrementTasks: mockIncrement,
                decrementTasks: mockDecrement
            },
            '../../src/utils/logger.js': { log: mockLog }
        });
    });

    it('runBackgroundAgent should skip if no prompts', async () => {
        const project = { id: 'p1', backgroundPrompts: [] };
        await backgroundAgent.runBackgroundAgent(project);
        expect(mockLog).toHaveBeenCalledWith('info', expect.stringContaining('Aucun prompt background'));
    });

    it('runBackgroundAgent should run a prompt loop successfully', async () => {
        const project = { id: 'p1', backgroundPrompts: ['p1'] };

        mockStartSession.mockResolvedValueOnce(true);
        // Break loop on first sleep after session
        mockSleep.mockImplementation((ms) => {
            if (ms === 300000) return Promise.reject(new Error('BREAK_LOOP'));
            return Promise.resolve();
        });
        mockLog.mockImplementation((level, msg, err) => {
            if (err && err.message === 'BREAK_LOOP') throw new Error('STOP_LOOP');
        });

        await expect(backgroundAgent.runBackgroundAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockIncrement).toHaveBeenCalledWith('p1');
        expect(mockStartSession).toHaveBeenCalled();
        expect(mockDecrement).toHaveBeenCalledWith('p1');
    });

    it('runBackgroundAgent should wait if project is locked', async () => {
        const project = { id: 'p1', backgroundPrompts: ['p1'] };
        mockIsLocked.mockResolvedValueOnce(true);
        // In this case, sleep(60000) is called, so we use it to break
        mockSleep.mockImplementationOnce(() => Promise.reject(new Error('BREAK_LOOP')));
        mockLog.mockImplementation((level, msg, err) => {
            if (err && err.message === 'BREAK_LOOP') throw new Error('STOP_LOOP');
        });

        await expect(backgroundAgent.runBackgroundAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockSleep).toHaveBeenCalledWith(60000);
        expect(mockStartSession).not.toHaveBeenCalled();
    });

    it('runBackgroundAgent should decrement and wait on error', async () => {
        const project = { id: 'p1', backgroundPrompts: ['p1'] };
        mockStartSession.mockRejectedValueOnce(new Error('Jules Fail'));

        // Break loop on first sleep in catch block
        mockSleep.mockImplementation((ms) => {
            if (ms === 60000) throw new Error('STOP_LOOP');
            return Promise.resolve();
        });

        await expect(backgroundAgent.runBackgroundAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockDecrement).toHaveBeenCalledWith('p1');
        expect(mockSleep).toHaveBeenCalledWith(60000);
    });
});
