import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('ControlCenter', () => {
  let ControlCenterModule;
  let controlCenter;
  let mockDatabase;

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
    };

    ControlCenterModule = await esmock('../../src/controlCenter.js', {
      '../../src/db/database.js': mockDatabase,
      '../../src/api/julesClient.js': {
        startAndMonitorSession: vi.fn(),
        getSession: vi.fn(),
        monitorExistingSession: vi.fn(),
      },
      '../../src/api/githubClient.js': {
        getNextGitHubIssue: vi.fn(),
        closeGitHubIssue: vi.fn(),
        mergeOpenPRs: vi.fn(),
        listOpenPRs: vi.fn().mockResolvedValue([]),
        getPRFiles: vi.fn(),
      },
      '../../src/services/metricsStore.js': {
        recordDashboardMetric: vi.fn(),
        getApiUsageSummary24h: vi.fn(),
      },
      '../../src/api/tokenRotation.js': {
        getTokenStatusSummary: vi.fn().mockReturnValue({ configured: true }),
      }
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

    // Mock the project being in the runtime map
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
});
