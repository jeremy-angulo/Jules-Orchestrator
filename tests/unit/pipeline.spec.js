import { test, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

const mockLog = vi.fn();
const mockCron = {
    schedule: vi.fn((sched, cb) => ({ schedule: sched, callback: cb }))
};
const mockSleep = vi.fn(async () => {});
const mockStartAndMonitorSession = vi.fn(async () => true);
const mockMergeOpenPRs = vi.fn(async () => {});
const mockDb = {
    lockProject: vi.fn(async () => {}),
    unlockProject: vi.fn(async () => {}),
    incrementTasks: vi.fn(async () => {}),
    decrementTasks: vi.fn(async () => {}),
    getActiveTasks: vi.fn(async () => 0)
};

const setupPipeline = async () => {
    return await esmock('../../src/agents/pipeline.js', {
        '../../src/utils/logger.js': { log: mockLog },
        'node-cron': mockCron,
        '../../src/utils/helpers.js': { sleep: mockSleep },
        '../../src/api/julesClient.js': { startAndMonitorSession: mockStartAndMonitorSession },
        '../../src/api/githubClient.js': { mergeOpenPRs: mockMergeOpenPRs },
        '../../src/db/database.js': mockDb
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

test('scheduleBuildAndMergePipeline - returns null if no pipeline config', async () => {
    const { scheduleBuildAndMergePipeline } = await setupPipeline();
    const result = scheduleBuildAndMergePipeline({ id: 'p1' });
    expect(result).toBeNull();
});

test('scheduleBuildAndMergePipeline - schedules cron if config exists', async () => {
    const { scheduleBuildAndMergePipeline } = await setupPipeline();
    const project = {
        id: 'p1',
        buildAndMergePipeline: { cronSchedule: '0 0 * * *' }
    };
    const result = scheduleBuildAndMergePipeline(project);
    expect(mockCron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
    expect(result).toBeDefined();
});

test('runBuildAndMergePipelineOnce - basic flow', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    await runBuildAndMergePipelineOnce(project);

    expect(mockDb.lockProject).toHaveBeenCalledWith('p1', 'pipeline');
    expect(mockDb.getActiveTasks).toHaveBeenCalledWith('p1');
    expect(mockDb.incrementTasks).toHaveBeenCalledWith('p1');
    expect(mockStartAndMonitorSession).toHaveBeenCalledWith('fix it', 'Pipeline Agent', project, expect.anything());
    expect(mockMergeOpenPRs).toHaveBeenCalledWith(project);
    expect(mockDb.unlockProject).toHaveBeenCalledWith('p1');
});

test('runBuildAndMergePipelineOnce - waits for active tasks', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    mockDb.getActiveTasks
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    await runBuildAndMergePipelineOnce(project);

    expect(mockSleep).toHaveBeenCalledWith(15000);
    expect(mockDb.incrementTasks).toHaveBeenCalled();
});

test('runBuildAndMergePipelineOnce - handles session failure and retries', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    // Fail once, then succeed
    mockStartAndMonitorSession
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    await runBuildAndMergePipelineOnce(project);

    expect(mockStartAndMonitorSession).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(30000); // Retry delay
});

test('runBuildAndMergePipelineOnce - phase feedback', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    await runBuildAndMergePipelineOnce(project);

    expect(mockStartAndMonitorSession).toHaveBeenCalledWith(
        'fix it',
        'Pipeline Agent',
        project,
        expect.objectContaining({ feedbackMessage: 'keep going' })
    );
});

test('runBuildAndMergePipelineOnce - waits active tasks timeout (1h) and triggers onTimeout', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    // Keep active tasks > 0 so the wait loop runs
    mockDb.getActiveTasks.mockResolvedValue(1);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    const onTimeoutSpy = vi.fn();

    await runBuildAndMergePipelineOnce(project, { onTimeout: onTimeoutSpy });

    // The loop iterates 240 times (3600s / 15s) calling sleep(15000) each time
    expect(mockSleep).toHaveBeenCalledTimes(241); // 240 times in wait loop, 1 time for sleep(10000) after timeout
    expect(mockDb.lockProject).toHaveBeenCalledWith('p1', 'pipeline-timeout');
    expect(onTimeoutSpy).toHaveBeenCalledWith('p1');
});

test('runBuildAndMergePipelineOnce - shouldStop stops during active tasks waiting', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    mockDb.getActiveTasks.mockResolvedValue(1);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    const shouldStop = vi.fn().mockReturnValue(true);

    await runBuildAndMergePipelineOnce(project, { shouldStop });

    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockDb.incrementTasks).not.toHaveBeenCalled();
    expect(mockStartAndMonitorSession).not.toHaveBeenCalled();
});

test('runBuildAndMergePipelineOnce - shouldStop stops during loop phase', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    mockDb.getActiveTasks.mockResolvedValue(0);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    const shouldStop = vi.fn().mockReturnValue(true);

    await runBuildAndMergePipelineOnce(project, { shouldStop });

    expect(mockStartAndMonitorSession).not.toHaveBeenCalled();
    expect(mockSleep).not.toHaveBeenCalled();
});

test('runBuildAndMergePipelineOnce - wrap-up phase feedback and project lock', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    mockDb.getActiveTasks.mockResolvedValue(0);
    mockStartAndMonitorSession.mockResolvedValue(true);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    const start = 1000000000000;
    const elapsed = 1.6 * 60 * 60 * 1000; // 1.6h elapsed (wrap-up is between 1.5h and 2.0h)

    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return start;
        return start + elapsed;
    });

    await runBuildAndMergePipelineOnce(project);

    expect(mockDb.lockProject).toHaveBeenCalledWith('p1', 'pipeline-wrapup');
    expect(mockStartAndMonitorSession).toHaveBeenCalledWith(
        'fix it',
        'Pipeline Agent',
        project,
        expect.objectContaining({
            feedbackMessage: expect.stringContaining('Time is almost up. Please wrap up')
        })
    );
});

test('runBuildAndMergePipelineOnce - buffer phase feedback and project lock', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    mockDb.getActiveTasks.mockResolvedValue(0);
    mockStartAndMonitorSession.mockResolvedValue(true);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    const start = 1000000000000;
    const elapsed = 2.1 * 60 * 60 * 1000; // 2.1h elapsed (buffer phase is > 2.0h)

    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return start;
        return start + elapsed;
    });

    await runBuildAndMergePipelineOnce(project);

    expect(mockDb.lockProject).toHaveBeenCalledWith('p1', 'pipeline-buffer');
    expect(mockStartAndMonitorSession).toHaveBeenCalledWith(
        'fix it',
        'Pipeline Agent',
        project,
        expect.objectContaining({
            feedbackMessage: expect.stringContaining('FINAL CALL: Finish now')
        })
    );
});

test('runBuildAndMergePipelineOnce - total global 3-hour timeout stops loop', async () => {
    const { runBuildAndMergePipelineOnce } = await setupPipeline();
    mockDb.getActiveTasks.mockResolvedValue(0);

    const project = {
        id: 'p1',
        buildAndMergePipeline: { prompt: 'fix it' }
    };

    const start = 1000000000000;
    const elapsed = 3.1 * 60 * 60 * 1000; // 3.1h elapsed (> 3h total timeout)

    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return start;
        return start + elapsed;
    });

    await runBuildAndMergePipelineOnce(project);

    expect(mockStartAndMonitorSession).not.toHaveBeenCalled();
});
