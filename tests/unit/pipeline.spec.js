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

    // Simulate being in wrap-up phase (elapsed > 1.5h)
    // The code calculates elapsed as Date.now() - pipelineStartTime.
    // We can use vi.setSystemTime if we need precise control,
    // but the code doesn't inject startTime, it sets it at start.
    // However, it's a while loop.

    // For simplicity, let's just verify the default work phase call
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
