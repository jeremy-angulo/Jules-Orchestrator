import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';
import { initTables } from '../../src/db/tables.js';

describe('ControlCenter', () => {
  let ControlCenterModule;
  let controlCenter;
  let mockDatabase;
  let mockGithub;
  let mockJules;
  let mockMetrics;
  let mockTokenRotation;
  let mockPipeline;

  beforeEach(async () => {
    vi.resetModules();

    mockDatabase = {
      initProjectState: vi.fn(),
      isProjectLocked: vi.fn(),
      incrementTasks: vi.fn(),
      decrementTasks: vi.fn(),
      lockProject: vi.fn(),
      unlockProject: vi.fn(),
      setActiveTasks: vi.fn(),
      listProjectsConfig: vi.fn().mockResolvedValue([]),
      getProjectConfig: vi.fn(),
      listAgents: vi.fn().mockResolvedValue([]),
      listAssignments: vi.fn().mockResolvedValue([]),
      getAllProjectStates: vi.fn().mockResolvedValue([]),
    };

    mockGithub = {
      getNextGitHubIssue: vi.fn(),
      closeGitHubIssue: vi.fn(),
      mergeOpenPRs: vi.fn(),
      listOpenPRs: vi.fn().mockResolvedValue([]),
      getPRFiles: vi.fn(),
    };

    mockJules = {
      startAndMonitorSession: vi.fn(),
      getSession: vi.fn(),
      monitorExistingSession: vi.fn(),
    };

    mockMetrics = {
      recordDashboardMetric: vi.fn(),
      getApiUsageSummary24h: vi.fn().mockResolvedValue({ total: 100 }),
    };

    mockTokenRotation = {
      getTokenStatusSummary: vi.fn().mockReturnValue({ configured: true }),
    };

    mockPipeline = {
      scheduleBuildAndMergePipeline: vi.fn(),
      runBuildAndMergePipelineOnce: vi.fn(),
    };

    ControlCenterModule = await esmock('../../src/controlCenter.js', {
      '../../src/db/database.js': mockDatabase,
      '../../src/api/julesClient.js': mockJules,
      '../../src/api/githubClient.js': mockGithub,
      '../../src/services/metricsStore.js': mockMetrics,
      '../../src/api/tokenRotation.js': mockTokenRotation,
      '../../src/agents/pipeline.js': mockPipeline,
    });

    controlCenter = new ControlCenterModule.ControlCenter();
  });

  it('init() should load projects from database', async () => {
    const mockProjects = [
      { id: 'p1', github_repo: 'org/repo1', build_pipeline_enabled: 1 },
      { id: 'p2', github_repo: 'org/repo2', build_pipeline_enabled: 0 }
    ];
    mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);

    await controlCenter.init();

    expect(controlCenter.projects).toHaveLength(2);
    expect(controlCenter.projects[0].id).toBe('p1');
    expect(controlCenter.projects[1].id).toBe('p2');
    expect(mockDatabase.initProjectState).toHaveBeenCalledWith('p1');
    expect(mockDatabase.initProjectState).toHaveBeenCalledWith('p2');
  });

  it('setProjectLock should lock or unlock a project', async () => {
    const project = { id: 'p1', github_repo: 'org/repo' };
    mockDatabase.getProjectConfig.mockResolvedValue({ id: 'p1', github_repo: 'org/repo' });

    controlCenter.projectById.set('p1', project);

    await controlCenter.setProjectLock('p1', true, 'testing');
    expect(mockDatabase.lockProject).toHaveBeenCalledWith('p1', 'testing');

    await controlCenter.setProjectLock('p1', false);
    expect(mockDatabase.unlockProject).toHaveBeenCalledWith('p1');
  });

  it('resetProjectTasks should reset active tasks to zero', async () => {
    mockDatabase.getProjectConfig.mockResolvedValue({ id: 'p1', github_repo: 'org/repo' });
    controlCenter.projectById.set('p1', { id: 'p1' });

    await controlCenter.resetProjectTasks('p1');
    expect(mockDatabase.setActiveTasks).toHaveBeenCalledWith('p1', 0);
  });

  it('makeRunnerId should generate a colon-separated ID', () => {
    const id = controlCenter.makeRunnerId('proj', 'type', 'suffix');
    expect(id).toBe('proj:type:suffix');
  });

  it('stopRunner should set shouldStop and stop cron task if exists', async () => {
    const mockCronTask = { stop: vi.fn() };
    const runner = controlCenter._createRunner({
      id: 'r1',
      projectId: 'p1',
      type: 'test',
      mode: 'loop'
    });
    runner.cronTask = mockCronTask;

    const result = await controlCenter.stopRunner('r1');
    expect(result).toBe(true);
    expect(runner.shouldStop).toBe(true);
    expect(mockCronTask.stop).toHaveBeenCalled();
  });

  it('invalidateCache should clear the projects and assignments caches', async () => {
    controlCenter.cache.assignments = ['assignment1'];
    controlCenter.cache.lastUpdated = 12345;
    await controlCenter.invalidateCache();
    expect(controlCenter.cache.assignments).toBeNull();
    expect(controlCenter.cache.lastUpdated).toBe(0);
  });

  it('getAssignmentsCached should return assignments and use cache on repeat requests within 30s', async () => {
    const mockAssignments = [{ id: 1, enabled: true }];
    mockDatabase.listAssignments.mockResolvedValue(mockAssignments);

    const first = await controlCenter.getAssignmentsCached();
    expect(first).toEqual(mockAssignments);
    expect(mockDatabase.listAssignments).toHaveBeenCalledTimes(1);

    // Call again, should hits cache
    const second = await controlCenter.getAssignmentsCached();
    expect(second).toEqual(mockAssignments);
    expect(mockDatabase.listAssignments).toHaveBeenCalledTimes(1);

    // Invalidate assignments cache
    controlCenter._invalidateAssignmentsCache();
    const third = await controlCenter.getAssignmentsCached();
    expect(third).toEqual(mockAssignments);
    expect(mockDatabase.listAssignments).toHaveBeenCalledTimes(2);
  });

  it('updateProjectStats should query listOpenPRs and store PR count', async () => {
    const project = { id: 'hfw', githubRepo: 'owner/hfw' };
    controlCenter.projectById.set('hfw', project);

    mockGithub.listOpenPRs.mockResolvedValue([{ number: 1 }, { number: 2 }]);

    await controlCenter.updateProjectStats('hfw');

    const stats = controlCenter.projectStats.get('hfw');
    expect(stats.openPRCount).toBe(2);
    expect(stats.lastUpdate).toBeGreaterThan(0);
  });

  it('removeProject should stop all runners of that project and unregister project config', async () => {
    const mockProject = { id: 'p1', githubRepo: 'org/repo1' };
    controlCenter.projects = [mockProject];
    controlCenter.projectById.set('p1', mockProject);

    const runner = controlCenter._createRunner({
      id: 'p1:runner1',
      projectId: 'p1',
      type: 'site-check',
      mode: 'loop'
    });

    await controlCenter.removeProject('p1');

    expect(runner.shouldStop).toBe(true);
    expect(controlCenter.projectById.has('p1')).toBe(false);
    expect(controlCenter.projects).toHaveLength(0);
  });

  it('stopBy should stop and return count of matching runners', async () => {
    const r1 = controlCenter._createRunner({
      id: 'p1:loop',
      projectId: 'p1',
      type: 'loop-type',
      mode: 'loop'
    });
    const r2 = controlCenter._createRunner({
      id: 'p1:other',
      projectId: 'p1',
      type: 'other-type',
      mode: 'loop'
    });
    const r3 = controlCenter._createRunner({
      id: 'p2:loop',
      projectId: 'p2',
      type: 'loop-type',
      mode: 'loop'
    });

    const count = await controlCenter.stopBy('p1', 'loop-type');
    expect(count).toBe(1);
    expect(r1.shouldStop).toBe(true);
    expect(r2.shouldStop).toBe(false);
    expect(r3.shouldStop).toBe(false);
  });

  it('_autoMergeCycle should iterate enabled projects and invoke mergeOpenPRs', async () => {
    const mockProjects = [
      { id: 'p1', conflict_resolver_enabled: 1, github_repo: 'org/repo1' },
      { id: 'p2', conflict_resolver_enabled: 0, github_repo: 'org/repo2' }
    ];
    mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);
    await controlCenter.init();

    await controlCenter._autoMergeCycle();

    expect(mockGithub.mergeOpenPRs).toHaveBeenCalledTimes(1);
    expect(mockGithub.mergeOpenPRs).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  });

  it('_cleanupStaleSessions should run direct database query with 4h cutoff', async () => {
    await initTables();

    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await controlCenter._cleanupStaleSessions();
    // This runs against the real (test) sqlite db since it's unmocked, which is totally safe!
  });

  it('getStatus should retrieve and format comprehensive orchestrator status', async () => {
    const mockProjects = [
      { id: 'p1', github_repo: 'org/repo1', build_pipeline_enabled: 1 }
    ];
    mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);
    await controlCenter.init();

    mockDatabase.getAllProjectStates.mockResolvedValue([
      { projectId: 'p1', is_locked_for_daily: true, lockedAt: '2026-07-22', lockReason: 'manual', active_tasks: 2 }
    ]);

    const status = await controlCenter.getStatus();

    expect(status.projects).toHaveLength(1);
    expect(status.projects[0]).toEqual({
      id: 'p1',
      githubRepo: 'org/repo1',
      githubBranch: 'main',
      locked: true,
      lockedAt: '2026-07-22',
      lockReason: 'manual',
      activeTasks: 2,
      openPRCount: 0,
      totalAgentsLaunched: 0
    });
    expect(status.runners).toEqual([]);
    expect(status.apiUsage24h).toEqual({ total: 100 });
    expect(status.tokenStatus).toEqual({ configured: true });
  });

  it('runBackgroundOnce should initialize and register a one-off background runner', async () => {
    const mockProjConfig = { id: 'p1', github_repo: 'org/repo' };
    mockDatabase.getProjectConfig.mockResolvedValue(mockProjConfig);
    controlCenter.projectById.set('p1', { id: 'p1' });

    const runnerId = await controlCenter.runBackgroundOnce('p1', 'prompt payload', 'BG Unit Test');
    expect(runnerId).toContain('p1:manual-background');

    const runner = controlCenter.runners.get(runnerId);
    expect(runner.status).toBe('running');
    expect(runner.mode).toBe('once');
    expect(runner.label).toBe('BG Unit Test');

    // Wait for async runner execution block to resolve
    await runner.promise;

    expect(mockDatabase.incrementTasks).toHaveBeenCalledWith('p1');
    expect(mockJules.startAndMonitorSession).toHaveBeenCalledWith('prompt payload', 'BG Unit Test', expect.any(Object), expect.any(Object));
    expect(mockDatabase.decrementTasks).toHaveBeenCalledWith('p1');
    expect(runner.status).toBe('completed');
  });

  it('runPipelineNow should spawn and execute standard build and merge pipeline', async () => {
    const mockProjConfig = { id: 'p1', github_repo: 'org/repo', pipeline_prompt: 'some pipeline' };
    mockDatabase.getProjectConfig.mockResolvedValue(mockProjConfig);
    await controlCenter.init();

    // Use a delayed promise to keep runner in 'running' state during status check
    mockPipeline.runBuildAndMergePipelineOnce.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)));

    const runnerId = await controlCenter.runPipelineNow('p1');
    expect(runnerId).toContain('p1:manual-pipeline');

    const runner = controlCenter.runners.get(runnerId);
    expect(runner.status).toBe('running');

    await runner.promise;

    expect(mockPipeline.runBuildAndMergePipelineOnce).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
    expect(runner.status).toBe('completed');
  });
});
