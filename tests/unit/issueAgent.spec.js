import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('issueAgent.js', () => {
    let issueAgent;
    let mockSleep;
    let mockGetNextIssue;
    let mockCloseIssue;
    let mockMergeOpenPRs;
    let mockStartSession;
    let mockIsLocked;
    let mockLock;
    let mockUnlock;
    let mockIncrement;
    let mockDecrement;
    let mockGetActiveTasks;
    let mockLog;

    beforeEach(async () => {
        mockSleep = vi.fn().mockResolvedValue(undefined);
        mockGetNextIssue = vi.fn();
        mockCloseIssue = vi.fn();
        mockMergeOpenPRs = vi.fn();
        mockStartSession = vi.fn();
        mockIsLocked = vi.fn().mockResolvedValue(false);
        mockLock = vi.fn();
        mockUnlock = vi.fn();
        mockIncrement = vi.fn();
        mockDecrement = vi.fn();
        mockGetActiveTasks = vi.fn().mockResolvedValue(1);
        mockLog = vi.fn();

        issueAgent = await esmock('../../src/agents/issueAgent.js', {
            '../../src/utils/helpers.js': { sleep: mockSleep },
            '../../src/api/githubClient.js': {
                getNextGitHubIssue: mockGetNextIssue,
                closeGitHubIssue: mockCloseIssue,
                mergeOpenPRs: mockMergeOpenPRs
            },
            '../../src/api/julesClient.js': {
                startAndMonitorSession: mockStartSession
            },
            '../../src/db/database.js': {
                isProjectLocked: mockIsLocked,
                lockProject: mockLock,
                unlockProject: mockUnlock,
                incrementTasks: mockIncrement,
                decrementTasks: mockDecrement,
                getActiveTasks: mockGetActiveTasks
            },
            '../../src/utils/logger.js': { log: mockLog }
        });
    });

    it('formatIssueInstruction should format instruction correctly with French security prefix', () => {
        const issue = { title: 'Bug test', body: 'Please fix it' };
        const result = issueAgent.formatIssueInstruction(issue);
        expect(result).toContain('Tu es un agent 100% autonome');
        expect(result).toContain('Bug test');
        expect(result).toContain('Please fix it');
    });

    it('formatIssueInstruction should fallback to empty description if body is missing or null', () => {
        const issue = { title: 'No body issue' };
        const result = issueAgent.formatIssueInstruction(issue);
        expect(result).toContain('Titre: No body issue');
        expect(result).toContain('Description: ');
    });

    it('runIssueAgent should process an issue successfully and then stop on mocked error', async () => {
        const project = { id: 'HomeFreeWorld' };
        const issue = { title: 'Fix CSS', number: 42 };

        mockGetNextIssue.mockResolvedValueOnce(issue);
        mockStartSession.mockResolvedValueOnce(true);

        // We throw in sleep(30000) which is at the end of the loop to break it
        mockSleep.mockImplementation((ms) => {
            if (ms === 30000) return Promise.reject(new Error('BREAK_LOOP'));
            return Promise.resolve();
        });
        mockLog.mockImplementation((level, msg, err) => {
            if (err && err.message === 'BREAK_LOOP') throw new Error('STOP_LOOP');
        });

        await expect(issueAgent.runIssueAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockLock).toHaveBeenCalledWith('HomeFreeWorld');
        expect(mockIncrement).toHaveBeenCalledWith('HomeFreeWorld');
        expect(mockMergeOpenPRs).toHaveBeenCalledWith(project);
        expect(mockStartSession).toHaveBeenCalled();
        expect(mockCloseIssue).toHaveBeenCalledWith(project, 42);
        expect(mockDecrement).toHaveBeenCalledWith('HomeFreeWorld');
        expect(mockUnlock).toHaveBeenCalledWith('HomeFreeWorld');
    });

    it('runIssueAgent should wait if project is locked', async () => {
        const project = { id: 'HomeFreeWorld' };
        mockIsLocked.mockResolvedValueOnce(true);
        // First sleep(30000) in the loop if locked
        mockSleep.mockImplementationOnce(() => Promise.reject(new Error('BREAK_LOOP')));
        mockLog.mockImplementation(() => { throw new Error('STOP_LOOP'); });

        await expect(issueAgent.runIssueAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockSleep).toHaveBeenCalledWith(30000);
        expect(mockGetNextIssue).not.toHaveBeenCalled();
    });

    it('runIssueAgent should handle Jules failure without closing issue', async () => {
        const project = { id: 'HomeFreeWorld' };
        const issue = { title: 'Fix CSS', number: 42 };

        mockGetNextIssue.mockResolvedValueOnce(issue);
        mockStartSession.mockResolvedValueOnce(false); // Failure

        mockSleep.mockImplementation((ms) => {
            if (ms === 30000) return Promise.reject(new Error('BREAK_LOOP'));
            return Promise.resolve();
        });
        mockLog.mockImplementation((level, msg, err) => {
            if (err && err.message === 'BREAK_LOOP') throw new Error('STOP_LOOP');
        });

        await expect(issueAgent.runIssueAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockStartSession).toHaveBeenCalled();
        expect(mockCloseIssue).not.toHaveBeenCalled();
        expect(mockUnlock).toHaveBeenCalledWith('HomeFreeWorld');
    });

    it('runIssueAgent should wait in sleep loop when active tasks > 1', async () => {
        const project = { id: 'HomeFreeWorld' };
        const issue = { title: 'Fix CSS', number: 42 };

        mockGetNextIssue.mockResolvedValueOnce(issue);
        mockGetActiveTasks.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
        mockStartSession.mockResolvedValueOnce(true);

        mockSleep.mockImplementation((ms) => {
            if (ms === 30000) return Promise.reject(new Error('BREAK_LOOP'));
            return Promise.resolve();
        });
        mockLog.mockImplementation((level, msg, err) => {
            if (err && err.message === 'BREAK_LOOP') throw new Error('STOP_LOOP');
        });

        await expect(issueAgent.runIssueAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockSleep).toHaveBeenCalledWith(15000);
        expect(mockStartSession).toHaveBeenCalled();
    });

    it('runIssueAgent should forward onTokenPicked option to startAndMonitorSession', async () => {
        const project = { id: 'HomeFreeWorld' };
        const issue = { title: 'Fix CSS', number: 42 };
        const onTokenPicked = vi.fn();

        mockGetNextIssue.mockResolvedValueOnce(issue);
        mockStartSession.mockResolvedValueOnce(true);

        mockSleep.mockImplementation((ms) => {
            if (ms === 30000) return Promise.reject(new Error('BREAK_LOOP'));
            return Promise.resolve();
        });
        mockLog.mockImplementation((level, msg, err) => {
            if (err && err.message === 'BREAK_LOOP') throw new Error('STOP_LOOP');
        });

        await expect(issueAgent.runIssueAgent(project, { onTokenPicked })).rejects.toThrow('STOP_LOOP');

        expect(mockStartSession).toHaveBeenCalledWith(
            expect.any(String),
            'Issue Agent',
            project,
            { onTokenPicked }
        );
    });

    it('runIssueAgent should catch critical errors, unlock project and sleep 60s', async () => {
        const project = { id: 'HomeFreeWorld' };
        mockGetNextIssue.mockRejectedValueOnce(new Error('GitHub API Error'));

        mockSleep.mockImplementation((ms) => {
            if (ms === 60000) throw new Error('STOP_LOOP');
            return Promise.resolve();
        });

        await expect(issueAgent.runIssueAgent(project)).rejects.toThrow('STOP_LOOP');

        expect(mockLog).toHaveBeenCalledWith('error', '[HomeFreeWorld] ❌ Erreur critique dans la boucle Issue :', expect.any(Error));
        expect(mockUnlock).toHaveBeenCalledWith('HomeFreeWorld');
        expect(mockSleep).toHaveBeenCalledWith(60000);
    });
});
