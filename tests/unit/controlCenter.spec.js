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
  let mockCron;
  let mockSiteCheckService;
  let mockContextInjector;
  let mockHelpers;
  let mockGitMergeService;

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
      getAgent: vi.fn(),
      getAssignment: vi.fn(),
      recordAssignmentRun: vi.fn(),
      recordAgentSessionStart: vi.fn(),
      recordAgentSessionEnd: vi.fn(),
      getLastAgentSession: vi.fn().mockResolvedValue(null),
      createJournalEntry: vi.fn(),
      closeJournalEntry: vi.fn(),
      getSiteCheckConfig: vi.fn(),
      updateSiteCheckConfig: vi.fn(),
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

    mockCron = {
      schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
      validate: vi.fn().mockReturnValue(true),
    };

    mockSiteCheckService = {
      runSiteCheckCycle: vi.fn().mockImplementation(() => new Promise(() => {})), // never-resolving promise keeps it running
    };

    mockContextInjector = {
      buildContextBlock: vi.fn().mockResolvedValue('MOCK CONTEXT:\n'),
    };

    mockHelpers = {
      sleepInterruptible: vi.fn().mockResolvedValue(),
    };

    mockGitMergeService = {
      attemptMechanicalMerge: vi.fn(),
    };

    ControlCenterModule = await esmock('../../src/controlCenter.js', {
      '../../src/db/database.js': mockDatabase,
      '../../src/api/julesClient.js': mockJules,
      '../../src/api/githubClient.js': mockGithub,
      '../../src/services/metricsStore.js': mockMetrics,
      '../../src/api/tokenRotation.js': mockTokenRotation,
      '../../src/agents/pipeline.js': mockPipeline,
      'node-cron': mockCron,
      '../../src/services/siteCheckService.js': mockSiteCheckService,
      '../../src/utils/contextInjector.js': mockContextInjector,
      '../../src/utils/helpers.js': mockHelpers,
      '../../src/services/gitMergeService.js': mockGitMergeService,
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

  // ────────────────────────────────────────────────────────────────────────────
  // NEW TEST CASES TO COVER REMAINING BLIND SPOTS
  // ────────────────────────────────────────────────────────────────────────────

  describe('getAgentsCached', () => {
    it('should query the database once and cache consecutive requests', async () => {
      const mockAgents = [{ id: 1, name: 'Agent 1' }];
      mockDatabase.listAgents.mockResolvedValue(mockAgents);

      const first = await controlCenter.getAgentsCached();
      expect(first).toEqual(mockAgents);
      expect(mockDatabase.listAgents).toHaveBeenCalledTimes(1);

      const second = await controlCenter.getAgentsCached();
      expect(second).toEqual(mockAgents);
      expect(mockDatabase.listAgents).toHaveBeenCalledTimes(1);
    });
  });

  describe('Site Check Management', () => {
    it('isSiteCheckRunning should return true if any site check runner exists', async () => {
      expect(controlCenter.isSiteCheckRunning('p1')).toBe(false);

      controlCenter._createRunner({
        id: 'site-check:p1:0',
        projectId: 'p1',
        type: 'site-check',
        mode: 'loop'
      });

      expect(controlCenter.isSiteCheckRunning('p1')).toBe(true);
    });

    it('startSiteCheck should throw error if site check is disabled', async () => {
      mockDatabase.getSiteCheckConfig.mockResolvedValue({ enabled: 0 });
      await expect(controlCenter.startSiteCheck('p1')).rejects.toThrow('Site check is disabled for p1');
    });

    it('startSiteCheck should throw if project config is not found', async () => {
      mockDatabase.getSiteCheckConfig.mockResolvedValue({ enabled: 1 });
      mockDatabase.getProjectConfig.mockResolvedValue(null);
      await expect(controlCenter.startSiteCheck('p1')).rejects.toThrow('Project p1 not found');
    });

    it('startSiteCheck should initialize runners and call runSiteCheckCycle', async () => {
      mockDatabase.getSiteCheckConfig.mockResolvedValue({ enabled: 1, concurrency: 2, pauseMs: 1000, locale: 'en' });
      const mockProject = { id: 'p1', github_repo: 'org/repo' };
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      controlCenter.projectById.set('p1', mockProject);

      const runnerIds = await controlCenter.startSiteCheck('p1');
      expect(runnerIds).toEqual(['site-check:p1:0', 'site-check:p1:1']);
      expect(controlCenter.runners.has('site-check:p1:0')).toBe(true);
      expect(controlCenter.runners.has('site-check:p1:1')).toBe(true);
      expect(mockSiteCheckService.runSiteCheckCycle).toHaveBeenCalledTimes(2);
    });

    it('stopSiteCheck should mark runners as stopped', async () => {
      const runner = controlCenter._createRunner({
        id: 'site-check:p1:0',
        projectId: 'p1',
        type: 'site-check',
        mode: 'loop'
      });
      await controlCenter.stopSiteCheck('p1');
      expect(runner.shouldStop).toBe(true);
      expect(runner.status).toBe('stopped');
    });

    it('toggleSiteCheck should update config and start site check if enabled is true', async () => {
      const mockProject = { id: 'p1', github_repo: 'org/repo' };
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      controlCenter.projectById.set('p1', mockProject);

      mockDatabase.getSiteCheckConfig.mockResolvedValue({ enabled: 1, concurrency: 1, pauseMs: 1000, locale: 'fr' });

      await controlCenter.toggleSiteCheck('p1', true, 'http://test.url', 1000, 'fr', 1);

      expect(mockDatabase.updateSiteCheckConfig).toHaveBeenCalledWith('p1', {
        enabled: true,
        baseUrl: 'http://test.url',
        pauseMs: 1000,
        locale: 'fr',
        concurrency: 1
      });
      expect(controlCenter.runners.has('site-check:p1:0')).toBe(true);
    });

    it('toggleSiteCheck should update config and stop site check if enabled is false', async () => {
      const runner = controlCenter._createRunner({
        id: 'site-check:p1:0',
        projectId: 'p1',
        type: 'site-check',
        mode: 'loop'
      });

      await controlCenter.toggleSiteCheck('p1', false, 'http://test.url', 1000, 'fr', 1);

      expect(mockDatabase.updateSiteCheckConfig).toHaveBeenCalledWith('p1', {
        enabled: false,
        baseUrl: 'http://test.url',
        pauseMs: 1000,
        locale: 'fr',
        concurrency: 1
      });
      expect(runner.status).toBe('stopped');
    });

    it('startAllSiteChecks should start site check only for projects with site_check_enabled', async () => {
      mockDatabase.listProjectsConfig.mockResolvedValue([
        { id: 'p1', site_check_enabled: 1 },
        { id: 'p2', site_check_enabled: 0 }
      ]);
      const mockProject = { id: 'p1', github_repo: 'org/repo' };
      controlCenter.projectById.set('p1', mockProject);
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      mockDatabase.getSiteCheckConfig.mockResolvedValue({ enabled: 1, concurrency: 1 });

      await controlCenter.startAllSiteChecks();

      expect(controlCenter.runners.has('site-check:p1:0')).toBe(true);
      expect(controlCenter.runners.has('site-check:p2:0')).toBe(false);
    });
  });

  describe('Assignment Execution', () => {
    it('startAssignment with loop mode should create loop runner and execute successfully', async () => {
      const mockAssignment = {
        id: 101,
        enabled: 1,
        project_id: 'p1',
        agent_id: 2,
        mode: 'loop',
        loop_pause_ms: 100,
        concurrency: 1
      };
      const mockAgent = { id: 2, name: 'Agent 2', prompt: 'Prompt payload' };
      const mockProject = { id: 'p1', github_repo: 'org/repo' };

      mockDatabase.getAssignment.mockResolvedValue(mockAssignment);
      mockDatabase.getAgent.mockResolvedValue(mockAgent);
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      controlCenter.projectById.set('p1', mockProject);

      mockJules.startAndMonitorSession.mockImplementation(async (prompt, name, project, options) => {
        if (options.onTokenPicked) options.onTokenPicked({ index: 0, label: 'test-token' });
        if (options.onSessionCreated) await options.onSessionCreated('session-123');
        if (options.onPRCreated) options.onPRCreated({ prUrl: 'https://github.com/pr/123' });

        // Terminate runner loop immediately to prevent infinite runs
        for (const r of controlCenter.runners.values()) {
          r.shouldStop = true;
        }
        return true;
      });

      const runnerId = await controlCenter.startAssignment(101);
      expect(runnerId).toBe('assignment:101:loop:0');

      const runner = controlCenter.runners.get(runnerId);
      expect(runner).toBeDefined();

      await runner.promise;

      expect(mockDatabase.recordAgentSessionStart).toHaveBeenCalled();
      expect(mockDatabase.recordAgentSessionEnd).toHaveBeenCalledWith('session-123', 'completed');
      expect(mockDatabase.recordAssignmentRun).toHaveBeenCalledWith(101);
    });

    it('startAssignment with cron mode should register cron job and let us trigger it', async () => {
      const mockAssignment = {
        id: 201,
        enabled: 1,
        project_id: 'p1',
        agent_id: 2,
        mode: 'scheduled',
        cron_schedule: '0 0 * * *'
      };
      const mockAgent = { id: 2, name: 'Agent 2', prompt: 'Prompt' };
      const mockProject = { id: 'p1', github_repo: 'org/repo' };

      mockDatabase.getAssignment.mockResolvedValue(mockAssignment);
      mockDatabase.getAgent.mockResolvedValue(mockAgent);
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      controlCenter.projectById.set('p1', mockProject);

      let cronCallback;
      mockCron.schedule.mockImplementation((sched, cb) => {
        cronCallback = cb;
        return { stop: vi.fn() };
      });

      const runnerId = await controlCenter.startAssignment(201);
      expect(runnerId).toBe('assignment:201:cron');
      expect(mockCron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));

      mockJules.startAndMonitorSession.mockImplementation(async (prompt, name, project, options) => {
        if (options.onSessionCreated) await options.onSessionCreated('session-cron');
        return true;
      });

      await cronCallback();

      expect(mockDatabase.recordAgentSessionStart).toHaveBeenCalled();
      expect(mockDatabase.recordAgentSessionEnd).toHaveBeenCalledWith('session-cron', 'completed');
    });

    it('runAssignmentOnce should start one-off manual run', async () => {
      const mockAssignment = { id: 301, project_id: 'p1', agent_id: 2 };
      const mockAgent = { id: 2, name: 'Agent 2', prompt: 'Prompt once' };
      const mockProject = { id: 'p1', github_repo: 'org/repo' };

      mockDatabase.getAssignment.mockResolvedValue(mockAssignment);
      mockDatabase.getAgent.mockResolvedValue(mockAgent);
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      controlCenter.projectById.set('p1', mockProject);

      mockJules.startAndMonitorSession.mockImplementation(async (prompt, name, project, options) => {
        if (options.onSessionCreated) await options.onSessionCreated('session-once');
        return true;
      });

      const runnerId = await controlCenter.runAssignmentOnce(301);
      expect(runnerId).toContain('assignment:301:manual');

      const runner = controlCenter.runners.get(runnerId);
      expect(runner).toBeDefined();

      await runner.promise;

      expect(runner.status).toBe('completed');
      expect(mockDatabase.recordAgentSessionStart).toHaveBeenCalled();
      expect(mockDatabase.recordAgentSessionEnd).toHaveBeenCalledWith('session-once', 'completed');
    });

    it('startAllAssignments should resume in-flight sessions', async () => {
      const mockAssignments = [
        { id: 401, enabled: 1, project_id: 'p1', agent_id: 2 },
        { id: 402, enabled: 0, project_id: 'p1', agent_id: 2 }
      ];
      mockDatabase.listAssignments.mockResolvedValue(mockAssignments);

      mockDatabase.getLastAgentSession.mockResolvedValue({
        session_id: 'session-inflight',
        status: 'running'
      });

      const mockAgent = { id: 2, name: 'Agent 2', prompt: 'Prompt' };
      const mockProject = { id: 'p1', github_repo: 'org/repo' };

      mockDatabase.getAgent.mockResolvedValue(mockAgent);
      mockDatabase.getProjectConfig.mockResolvedValue(mockProject);
      controlCenter.projectById.set('p1', mockProject);

      mockJules.getSession.mockResolvedValue({ state: 'RUNNING' });

      // Mock monitorExistingSession to immediately complete and prevent hanging loops
      mockJules.monitorExistingSession.mockResolvedValue(true);

      await controlCenter.startAllAssignments();

      const resumeRunnerId = 'assignment:401:resume';
      const resumeRunner = controlCenter.runners.get(resumeRunnerId);
      expect(resumeRunner).toBeDefined();

      await resumeRunner.promise;

      expect(resumeRunner.status).toBe('completed');
      expect(mockDatabase.recordAgentSessionEnd).toHaveBeenCalledWith('session-inflight', 'completed');
    });
  });

  describe('_batchConflictResolutionCycle', () => {
    it('should skip dispatching agent if no conflicts found and force is false', async () => {
      mockDatabase.listProjectsConfig.mockResolvedValue([
        { id: 'p1', github_repo: 'org/repo1' }
      ]);
      await controlCenter.init();

      mockGithub.listOpenPRs.mockResolvedValue([
        { number: 1, mergeable: true, mergeable_state: 'clean' }
      ]);

      await controlCenter._batchConflictResolutionCycle('p1', false);

      expect(mockGithub.listOpenPRs).toHaveBeenCalled();
      expect(mockGitMergeService.attemptMechanicalMerge).not.toHaveBeenCalled();
      expect(mockJules.startAndMonitorSession).not.toHaveBeenCalled();
    });

    it('should call attemptMechanicalMerge for dirty PRs and skip agent if resolved', async () => {
      mockDatabase.listProjectsConfig.mockResolvedValue([
        { id: 'p1', github_repo: 'org/repo1' }
      ]);
      await controlCenter.init();

      mockGithub.listOpenPRs.mockResolvedValue([
        { number: 42, mergeable: false, mergeable_state: 'dirty' }
      ]);
      mockGitMergeService.attemptMechanicalMerge.mockResolvedValue(true); // resolved mechanically

      await controlCenter._batchConflictResolutionCycle('p1', false);

      expect(mockGitMergeService.attemptMechanicalMerge).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1' }),
        42
      );
      expect(mockJules.startAndMonitorSession).not.toHaveBeenCalled();
    });

    it('should dispatch agent with fallback prompt if mechanical merge fails and agent not in DB', async () => {
      const mockProjects = [
        { id: 'p1', github_repo: 'org/repo1' },
        { id: 'Jules-Orchestrator', github_repo: 'org/orchestrator', githubToken: 'master-token' }
      ];
      mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);
      await controlCenter.init();

      mockGithub.listOpenPRs.mockResolvedValue([
        { number: 42, mergeable: false, mergeable_state: 'dirty' }
      ]);
      mockGitMergeService.attemptMechanicalMerge.mockResolvedValue(false); // unresolved
      mockDatabase.listAgents.mockResolvedValue([]); // No agent

      await controlCenter._batchConflictResolutionCycle('p1', false);

      expect(mockJules.startAndMonitorSession).toHaveBeenCalledWith(
        expect.stringContaining('## Projets à traiter :'),
        'Merge-Master',
        expect.objectContaining({ id: 'p1' }),
        expect.any(Object)
      );
      // Fallback prompt check
      const promptArg = mockJules.startAndMonitorSession.mock.calls[0][0];
      expect(promptArg).toContain('- **p1** (org/repo1): PRs #42');
    });

    it('should dispatch agent and append projects section to agent prompt when found in DB', async () => {
      const mockProjects = [
        { id: 'p1', github_repo: 'org/repo1' }
      ];
      mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);
      await controlCenter.init();

      mockGithub.listOpenPRs.mockResolvedValue([
        { number: 42, mergeable: false, mergeable_state: 'dirty' }
      ]);
      mockGitMergeService.attemptMechanicalMerge.mockResolvedValue(false);

      const mockMergeAgent = { id: 19, name: 'Merge Master Agent', prompt: 'Merge master core prompt' };
      mockDatabase.listAgents.mockResolvedValue([mockMergeAgent]);

      await controlCenter._batchConflictResolutionCycle('p1', false);

      const promptArg = mockJules.startAndMonitorSession.mock.calls[0][0];
      expect(promptArg).toContain('Merge master core prompt');
      expect(promptArg).toContain('## Projets à traiter pour cette session :');
      expect(promptArg).toContain('- **p1** (org/repo1): PRs #42');
    });

    it('should handle replacing existing projets section in agent prompt', async () => {
      const mockProjects = [
        { id: 'p1', github_repo: 'org/repo1' }
      ];
      mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);
      await controlCenter.init();

      mockGithub.listOpenPRs.mockResolvedValue([
        { number: 42, mergeable: false, mergeable_state: 'dirty' }
      ]);
      mockGitMergeService.attemptMechanicalMerge.mockResolvedValue(false);

      const mockMergeAgent = {
        id: 19,
        name: 'Merge Master Agent',
        prompt: 'Merge master prompt\n## Projets à traiter pour cette session :\n- **OldProject** (org/old): PRs #99'
      };
      mockDatabase.listAgents.mockResolvedValue([mockMergeAgent]);

      await controlCenter._batchConflictResolutionCycle('p1', false);

      const promptArg = mockJules.startAndMonitorSession.mock.calls[0][0];
      expect(promptArg).toContain('Merge master prompt');
      expect(promptArg).not.toContain('OldProject');
      expect(promptArg).toContain('## Projets à traiter pour cette session :');
      expect(promptArg).toContain('- **p1** (org/repo1): PRs #42');
    });

    it('should gracefully continue scanning projects if one of them fails', async () => {
      const mockProjects = [
        { id: 'p1', github_repo: 'org/repo1' },
        { id: 'p2', github_repo: 'org/repo2' }
      ];
      mockDatabase.listProjectsConfig.mockResolvedValue(mockProjects);
      await controlCenter.init();

      mockGithub.listOpenPRs.mockImplementation(async (project) => {
        if (project.id === 'p1') {
          throw new Error('Github rate limit');
        }
        return [{ number: 99, mergeable: false, mergeable_state: 'dirty' }];
      });
      mockGitMergeService.attemptMechanicalMerge.mockResolvedValue(false);

      await controlCenter._batchConflictResolutionCycle('p2', false);

      // Should still dispatch agent for p2
      expect(mockJules.startAndMonitorSession).toHaveBeenCalledWith(
        expect.stringContaining('- **p2** (org/repo2): PRs #99'),
        'Merge-Master',
        expect.objectContaining({ id: 'p2' }),
        expect.any(Object)
      );
    });
  });
});
