import cron from 'node-cron';
import { sleepInterruptible } from './utils/helpers.js';
import { startAndMonitorSession, getSession, monitorExistingSession } from './api/julesClient.js';
import { getNextGitHubIssue, closeGitHubIssue, mergeOpenPRs } from './api/githubClient.js';
import { formatIssueInstruction } from './agents/issueAgent.js';
import {
  scheduleBuildAndMergePipeline,
  runBuildAndMergePipelineOnce
} from './agents/pipeline.js';
import {
  initProjectState,
  isProjectLocked,
  incrementTasks,
  decrementTasks,
  lockProject,
  unlockProject,
  getActiveTasks,
  setActiveTasks,
  getAllProjectStates,
  getApiUsageSummary24h,
  getAgent,
  listAssignments,
  getAssignment,
  listProjectsConfig,
  getProjectConfig,
  recordAssignmentRun,
  recordAgentSessionStart,
  recordAgentSessionEnd,
  getLastAgentSession
} from './db/database.js';
import { sendOpsAlert } from './utils/alerting.js';
import { getTokenStatusSummary } from './api/tokenRotation.js';

const MAX_EVENTS = 300;
const DEFAULT_BG_PAUSE_MS = 300000;
const LOCK_WAIT_MS = 30000;

function nowIso() {
  return new Date().toISOString();
}

export class ControlCenter {
  constructor() {
    this.projects = [];
    this.projectById = new Map();
    this.runners = new Map();
    this.events = [];
    this.startedAt = nowIso();
    this.systemRunners = {
      globalDailyMerge: null,
      autoMergeService: null,
      perProjectPipelines: new Map()
    };
    this.projectStats = new Map(); // projectId -> { openPRCount, lastUpdate }
  }

  async updateProjectStats(projectId) {
    const project = this.getProject(projectId);
    if (!project || !project.githubRepo) return;
    try {
      const { listOpenPRs } = await import('./api/githubClient.js');
      const prs = await listOpenPRs(project);
      this.projectStats.set(projectId, {
        openPRCount: prs.length,
        lastUpdate: Date.now()
      });
    } catch (err) {
      this.log('error', `Failed to update project stats for ${projectId}`, { error: err.message });
    }
  }

  log(level, message, meta = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: nowIso(),
      level,
      message,
      meta
    };
    this.events.unshift(entry);
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    const out = level === 'error' ? console.error : console.log;
    out(`[ControlCenter] ${message}`, meta);
  }

  async initProjectInDB(project) {
    await initProjectState(project.id);
  }

  getProject(projectId) {
    return this.projectById.get(projectId);
  }

  _buildRuntimeProject(dbRow) {
    return {
      id: dbRow.id,
      githubRepo: dbRow.github_repo,
      githubBranch: dbRow.github_branch || 'main',
      githubToken: dbRow.github_token || process.env.GITHUB_TOKEN || '',
      backgroundPrompts: [],
      buildAndMergePipeline: dbRow.pipeline_cron ? {
        cronSchedule: dbRow.pipeline_cron,
        prompt: dbRow.pipeline_prompt || ''
      } : null
    };
  }

  async getProjectRuntime(projectId) {
    const inMemory = this.projectById.get(projectId);
    if (inMemory) return inMemory;
    const dbRow = await getProjectConfig(projectId);
    if (dbRow) return this._buildRuntimeProject(dbRow);
    return null;
  }

  async init() {
    this.projects = [];
    this.projectById = new Map();

    const dbProjects = await listProjectsConfig();
    for (const dbRow of dbProjects) {
      const runtime = this._buildRuntimeProject(dbRow);
      this.projects.push(runtime);
      this.projectById.set(runtime.id, runtime);
      await initProjectState(dbRow.id);
    }
  }

  async _buildProjectReadiness(project) {
    const tokenStatus = getTokenStatusSummary();
    const hasGitHubToken = !!(project.githubToken || '').trim() || !!process.env.GITHUB_TOKEN;
    const hasJulesToken = tokenStatus.configured;
    
    return {
      hasGitHubToken,
      hasJulesToken,
      ready: hasGitHubToken && hasJulesToken
    };
  }

  makeRunnerId(projectId, type, suffix = '') {
    return [projectId, type, suffix].filter(Boolean).join(':');
  }

  getRunnerSnapshot(runner) {
    return {
      id: runner.id,
      projectId: runner.projectId,
      type: runner.type,
      mode: runner.mode,
      label: runner.label,
      status: runner.status,
      iterations: runner.iterations,
      startedAt: runner.startedAt,
      stoppedAt: runner.stoppedAt,
      lastHeartbeatAt: runner.lastHeartbeatAt,
      stopRequestedAt: runner.stopRequestedAt,
      intervalMs: runner.intervalMs,
      details: runner.details,
      killAt: runner.killAt,
      errorCount: runner.errorCount,
      lastError: runner.lastError,
      sessionId: runner.sessionId
    };
  }

  listRunners() {
    return Array.from(this.runners.values()).map((runner) => this.getRunnerSnapshot(runner));
  }

  _createRunner({ id, projectId, type, mode, label, intervalMs = null, details = {} }) {
    if (this.runners.has(id)) {
      throw new Error(`Runner already exists: ${id}`);
    }
    const runner = {
      id,
      projectId,
      type,
      mode,
      label,
      intervalMs,
      details,
      status: 'running',
      iterations: 0,
      errorCount: 0,
      lastError: null,
      startedAt: nowIso(),
      stoppedAt: null,
      stopRequestedAt: null,
      lastHeartbeatAt: nowIso(),
      shouldStop: false,
      killAt: null,
      keepInRegistryAfterStop: false,
      promise: null,
      sessionId: null
    };
    this.runners.set(id, runner);
    this.log('info', 'Runner started', { runnerId: id, projectId, type, mode, label });
    return runner;
  }

  _heartbeat(runner) {
    if (runner.killAt && Date.now() >= runner.killAt) {
      runner.shouldStop = true;
      runner.lastError = 'Stopped by runtime kill timer.';
      runner.errorCount += 1;
    }
    runner.lastHeartbeatAt = nowIso();
  }

  _markRunnerStopped(runner, status = 'stopped', err = null) {
    runner.status = status;
    runner.stoppedAt = nowIso();
    if (err) {
      runner.errorCount += 1;
      runner.lastError = String(err?.message || err);
    }
    this.log(err ? 'error' : 'info', 'Runner stopped', {
      runnerId: runner.id,
      status,
      error: runner.lastError
    });
    if (status === 'failed' || runner.lastError) {
      sendOpsAlert('Runner failure', {
        runnerId: runner.id,
        projectId: runner.projectId,
        type: runner.type,
        status,
        error: runner.lastError
      }).catch(() => {});
    }
    if (!runner.keepInRegistryAfterStop) {
      this.runners.delete(runner.id);
    }
  }

  async stopRunner(runnerId) {
    const runner = this.runners.get(runnerId);
    if (!runner) {
      return false;
    }
    runner.shouldStop = true;
    runner.stopRequestedAt = nowIso();
    if (runner.cronTask && typeof runner.cronTask.stop === 'function') {
      runner.cronTask.stop();
      runner.status = 'stopped';
      runner.stoppedAt = nowIso();
      this.log('info', 'Cron runner stopped', { runnerId });
      if (!runner.keepInRegistryAfterStop) {
        this.runners.delete(runner.id);
      }
    }
    return true;
  }

  isAssignmentRunning(assignmentId) {
    const loopId = `assignment:${assignmentId}:loop`;
    const cronId = `assignment:${assignmentId}:cron`;
    const resumeId = `assignment:${assignmentId}:resume`;
    return this.runners.has(loopId) || this.runners.has(cronId) || this.runners.has(resumeId);
  }

  async stopAssignment(assignmentId) {
    const loopId = `assignment:${assignmentId}:loop`;
    const cronId = `assignment:${assignmentId}:cron`;
    const resumeId = `assignment:${assignmentId}:resume`;
    await this.stopRunner(loopId);
    await this.stopRunner(cronId);
    await this.stopRunner(resumeId);
  }

  async stopBy(projectId, type = null) {
    let count = 0;
    for (const runner of this.runners.values()) {
      if (runner.projectId !== projectId) continue;
      if (type && runner.type !== type) continue;
      if (await this.stopRunner(runner.id)) {
        count += 1;
      }
    }
    return count;
  }

  async _runLoop(runner, cycleFn, idleDelayMs) {
    try {
      while (!runner.shouldStop) {
        this._heartbeat(runner);
        await cycleFn();
        runner.iterations += 1;
        this._heartbeat(runner);
        if (runner.shouldStop) {
          break;
        }
        await sleepInterruptible(idleDelayMs, () => runner.shouldStop);
      }
      this._markRunnerStopped(runner, 'stopped');
    } catch (err) {
      this._markRunnerStopped(runner, 'failed', err);
    }
  }

  async runBackgroundOnce(projectId, prompt, label = 'Background Manual', options = {}) {
    const project = await this.getProjectRuntime(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    const runnerId = this.makeRunnerId(projectId, 'manual-background', Date.now().toString());
    const runner = this._createRunner({
      id: runnerId,
      projectId,
      type: 'manual-background',
      mode: 'once',
      label,
      details: { manual: true, preferredTokenId: options.preferredTokenId || null }
    });
    runner.keepInRegistryAfterStop = true;

    runner.promise = (async () => {
      try {
        await incrementTasks(projectId);
        await startAndMonitorSession(prompt, label, project, {
          shouldStop: () => runner.shouldStop,
          preferredTokenId: runner.details?.preferredTokenId || null,
          onSessionCreated: (id) => { runner.sessionId = id; }
        });
        runner.iterations = 1;
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        this._markRunnerStopped(runner, 'failed', err);
      } finally {
        await decrementTasks(projectId);
      }
    })();

    return runnerId;
  }

  async runPipelineNow(projectId) {
    const project = await this.getProjectRuntime(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    if (!project.buildAndMergePipeline) {
      throw new Error('Pipeline is not configured for this project.');
    }

    const runnerId = this.makeRunnerId(projectId, 'manual-pipeline', Date.now().toString());
    const runner = this._createRunner({
      id: runnerId,
      projectId,
      type: 'manual-pipeline',
      mode: 'once',
      label: 'Build & Merge (manual)'
    });
    runner.keepInRegistryAfterStop = true;

    runner.promise = (async () => {
      try {
        await runBuildAndMergePipelineOnce(project, { 
          shouldStop: () => runner.shouldStop
        });
        runner.iterations = 1;
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        this._markRunnerStopped(runner, 'failed', err);
      }
    })();

    return runnerId;
  }

  async startCustomLoop(projectId, prompt, label = 'Custom Loop', intervalMs = 120000, options = {}) {
    const project = await this.getProjectRuntime(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required for custom loops.');
    }

    const runnerId = this.makeRunnerId(projectId, 'custom-loop', Date.now().toString());
    const runner = this._createRunner({
      id: runnerId,
      projectId,
      type: 'custom-loop',
      mode: 'loop',
      label,
      intervalMs,
      details: { preferredTokenId: options.preferredTokenId || null }
    });

    runner.promise = this._runLoop(
      runner,
      async () => {
        if (await isProjectLocked(projectId)) {
          await sleepInterruptible(LOCK_WAIT_MS, () => runner.shouldStop);
          return;
        }
        await incrementTasks(projectId);
        try {
          await startAndMonitorSession(prompt, label, project, {
            shouldStop: () => runner.shouldStop,
            preferredTokenId: runner.details?.preferredTokenId || null
          });
        } finally {
          await decrementTasks(projectId);
        }
      },
      Math.max(5000, Number(intervalMs) || 120000)
    );

    return runnerId;
  }

  async setProjectLock(projectId, locked) {
    if (!await this.getProjectRuntime(projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    if (locked) {
      await lockProject(projectId);
    } else {
      await unlockProject(projectId);
    }
  }

  async resetProjectTasks(projectId) {
    if (!await this.getProjectRuntime(projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    await setActiveTasks(projectId, 0);
  }

  async stopAll() {
    for (const runnerId of Array.from(this.runners.keys())) {
      await this.stopRunner(runnerId);
    }
  }

  async startSchedulers() {
    // Initial stats update
    for (const project of this.projects) {
      this.updateProjectStats(project.id).catch(() => {});
    }

    if (!this.statsInterval) {
      this.statsInterval = setInterval(() => {
        for (const project of this.projects) {
          this.updateProjectStats(project.id).catch(() => {});
        }
      }, 5 * 60 * 1000);
    }

    for (const project of this.projects) {
      if (!project.buildAndMergePipeline) continue;
      if (this.systemRunners.perProjectPipelines.has(project.id)) continue;
      const task = scheduleBuildAndMergePipeline(project);
      this.systemRunners.perProjectPipelines.set(project.id, task);
      this.log('info', 'Project pipeline scheduler started', { projectId: project.id });
    }
  }

  async stopSchedulers() {
    for (const [projectId, task] of this.systemRunners.perProjectPipelines.entries()) {
      task.stop();
      this.systemRunners.perProjectPipelines.delete(projectId);
    }
  }

  async startAll() {
    await this.init();
    await this.startSchedulers();
    await this.startAllAssignments();
  }

  async runAgentOnce(projectId, agentId, options = {}) {
    let prompt = '';
    let agentName = '';
    
    if (agentId === 'custom') {
      prompt = options.instructions || '';
      agentName = 'Custom Agent';
    } else {
      const agent = await getAgent(agentId);
      if (!agent) throw new Error(`Agent ${agentId} not found`);
      prompt = agent.prompt;
      agentName = agent.name;
    }

    const project = await this.getProjectRuntime(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const runnerId = this.makeRunnerId(projectId, 'agent-once', `${agentId}:${Date.now()}`);
    const runner = this._createRunner({
      id: runnerId,
      projectId,
      type: 'agent-once',
      mode: 'once',
      label: agentId === 'custom' ? 'Custom Prompt (manual)' : `${agentName} (manual)`,
      details: { agentId, agentName }
    });
    runner.keepInRegistryAfterStop = true;

    runner.promise = (async () => {
      await incrementTasks(projectId);
      try {
        await startAndMonitorSession(prompt, agentName, project, { 
          shouldStop: () => runner.shouldStop,
          media: options.media,
          onSessionCreated: (id) => { runner.sessionId = id; }
        });
        runner.iterations = 1;
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        this._markRunnerStopped(runner, 'failed', err);
      } finally {
        await decrementTasks(projectId);
      }
    })();

    return runnerId;
  }

  async startAssignment(assignmentId) {
    const assignment = await getAssignment(assignmentId);
    if (!assignment || !assignment.enabled) return null;

    const agent = assignment.agent_id ? await getAgent(assignment.agent_id) : { name: 'Custom Agent', prompt: assignment.custom_prompt || '' };
    if (!agent) throw new Error(`Agent ${assignment.agent_id} not found`);
    const project = await this.getProjectRuntime(assignment.project_id);
    if (!project) throw new Error(`Project ${assignment.project_id} not found`);

    if (assignment.mode === 'loop') {
      return this._startAssignmentLoop(assignment, agent, project);
    } else if (assignment.mode === 'scheduled') {
      return this._startAssignmentCron(assignment, agent, project);
    }
    return null;
  }

  async _startAssignmentLoop(assignment, agent, project) {
    const runnerId = `assignment:${assignment.id}:loop`;
    if (this.runners.has(runnerId)) return runnerId;

    const pauseMs = Math.max(60000, Number(assignment.loop_pause_ms) || 300000);
    const runner = this._createRunner({
      id: runnerId,
      projectId: project.id,
      type: 'assignment-loop',
      mode: 'loop',
      label: `${agent.name} (loop)`,
      intervalMs: pauseMs,
      details: { assignmentId: assignment.id, agentId: assignment.id ? agent.id : null, agentName: agent.name }
    });

    runner.promise = this._runLoop(
      runner,
      async () => {
        const current = await getAssignment(assignment.id);
        if (!current || !current.enabled) { runner.shouldStop = true; return; }
        if (await isProjectLocked(project.id)) {
          await sleepInterruptible(LOCK_WAIT_MS, () => runner.shouldStop);
          return;
        }
        await incrementTasks(project.id);
        try {
          const prompt = current.agent_id ? agent.prompt : current.custom_prompt;
          await startAndMonitorSession(prompt, agent.name, await this.getProjectRuntime(project.id), {
            shouldStop: () => runner.shouldStop,
            onSessionCreated: async (sessionId) => {
              runner.sessionId = sessionId;
              await recordAgentSessionStart({ assignmentId: assignment.id, projectId: project.id, agentName: agent.name, sessionId });
            }
          });
          if (runner.sessionId) await recordAgentSessionEnd(runner.sessionId, 'completed');
          await recordAssignmentRun(assignment.id);
        } catch (err) {
          if (runner.sessionId) await recordAgentSessionEnd(runner.sessionId, 'failed');
          throw err;
        } finally {
          await decrementTasks(project.id);
        }
      },
      pauseMs
    );

    return runnerId;
  }

  async _startAssignmentCron(assignment, agent, project) {
    const runnerId = `assignment:${assignment.id}:cron`;
    if (this.runners.has(runnerId)) return runnerId;

    const schedule = assignment.cron_schedule;
    if (!schedule || !cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    const runner = this._createRunner({
      id: runnerId,
      projectId: project.id,
      type: 'assignment-cron',
      mode: 'scheduled',
      label: `${agent.name} (${schedule})`,
      details: { assignmentId: assignment.id, agentId: assignment.id ? agent.id : null, agentName: agent.name, cronSchedule: schedule }
    });

    const task = cron.schedule(schedule, async () => {
      const current = await getAssignment(assignment.id);
      if (!current || !current.enabled || runner.shouldStop) return;
      runner.lastHeartbeatAt = nowIso();
      runner.iterations += 1;

      const currentProject = await this.getProjectRuntime(project.id);
      await incrementTasks(project.id);
      try {
        const prompt = current.agent_id ? agent.prompt : current.custom_prompt;
        await startAndMonitorSession(prompt, agent.name, currentProject, { 
          shouldStop: () => runner.shouldStop,
          onSessionCreated: (id) => { runner.sessionId = id; }
        });
        await recordAssignmentRun(assignment.id);
      } finally {
        await decrementTasks(project.id);
      }
    });

    runner.cronTask = task;
    return runnerId;
  }

  async runAssignmentOnce(assignmentId) {
    const assignment = await getAssignment(assignmentId);
    if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);

    const agent = await getAgent(assignment.agent_id);
    if (!agent) throw new Error(`Agent ${assignment.agent_id} not found`);
    const project = await this.getProjectRuntime(assignment.project_id);
    if (!project) throw new Error(`Project ${assignment.project_id} not found`);

    const runnerId = `assignment:${assignmentId}:manual:${Date.now()}`;
    const runner = this._createRunner({
      id: runnerId,
      projectId: project.id,
      type: 'assignment-once',
      mode: 'once',
      label: `${agent.name} (manual run)`,
      details: { assignmentId, agentId: agent.id, agentName: agent.name }
    });
    runner.keepInRegistryAfterStop = true;

    runner.promise = (async () => {
      await incrementTasks(project.id);
      try {
        await startAndMonitorSession(agent.prompt, agent.name, project, { 
          shouldStop: () => runner.shouldStop,
          onSessionCreated: (id) => { runner.sessionId = id; }
        });
        await recordAssignmentRun(assignmentId);
        runner.iterations = 1;
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        this._markRunnerStopped(runner, 'failed', err);
      } finally {
        await decrementTasks(project.id);
      }
    })();

    return runnerId;
  }

  async startAllAssignments() {
    const assignments = await listAssignments();
    for (const assignment of assignments) {
      if (!assignment.enabled) continue;
      try {
        const lastSession = await getLastAgentSession(assignment.id);
        if (lastSession && lastSession.status === 'running') {
            const agent = assignment.agent_id ? await getAgent(assignment.agent_id) : { name: 'Custom Agent' };
            const project = await this.getProjectRuntime(assignment.project_id);
            const julesState = project ? await getSession(agent?.name || 'Agent', lastSession.session_id).catch(() => null) : null;
            if (julesState && julesState.state !== 'COMPLETED' && julesState.state !== 'FAILED') {
              this.log('info', `Resuming in-flight Jules session for assignment ${assignment.id}`, { sessionId: lastSession.session_id, state: julesState.state });
              this._resumeSessionForAssignment(assignment, lastSession, agent);
              continue;
            } else {
              await recordAgentSessionEnd(lastSession.session_id, julesState?.state === 'COMPLETED' ? 'completed' : 'failed');
            }
        }
        await this.startAssignment(assignment.id);
      } catch (err) {
        this.log('error', `Failed to start assignment ${assignment.id}`, { error: err.message });
      }
    }
  }

  async _resumeSessionForAssignment(assignment, sessionRecord, agent) {
    const project = await this.getProjectRuntime(assignment.project_id);
    if (!project) return;
    const agentName = agent?.name || 'Agent';
    const runnerId = `assignment:${assignment.id}:resume`;
    if (this.runners.has(runnerId)) return;

    const runner = this._createRunner({
      id: runnerId,
      projectId: project.id,
      type: 'assignment-loop',
      mode: 'loop',
      label: `${agentName} (resumed)`,
      details: { assignmentId: assignment.id, agentName }
    });
    runner.sessionId = sessionRecord.session_id;

    runner.promise = (async () => {
      try {
        await incrementTasks(project.id);
        const result = await monitorExistingSession(sessionRecord.session_id, agentName, project, { shouldStop: () => runner.shouldStop });
        await recordAgentSessionEnd(sessionRecord.session_id, result ? 'completed' : 'failed');
        await recordAssignmentRun(assignment.id);
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        await recordAgentSessionEnd(sessionRecord.session_id, 'failed');
        this._markRunnerStopped(runner, 'failed', err);
      } finally {
        await decrementTasks(project.id);
        this.startAssignment(assignment.id).catch(() => {});
      }
    })();
  }

  async getStatus() {
    const states = await getAllProjectStates();
    const usage = await getApiUsageSummary24h();

    const projects = [];
    for (const project of this.projects) {
      const state = states.find((s) => s.projectId === project.id) || {
        projectId: project.id,
        is_locked_for_daily: false,
        active_tasks: 0
      };
      const stats = this.projectStats.get(project.id) || { openPRCount: 0 };
      const totalAgentsLaunched = Array.from(this.runners.values()).filter(r => r.projectId === project.id).length;

      projects.push({
        id: project.id,
        githubRepo: project.githubRepo,
        githubBranch: project.githubBranch,
        locked: state.is_locked_for_daily,
        activeTasks: state.active_tasks,
        openPRCount: stats.openPRCount,
        totalAgentsLaunched
      });
    }

    const tokenStatus = getTokenStatusSummary();

    return {
      startedAt: this.startedAt,
      now: nowIso(),
      projects,
      runners: this.listRunners(),
      events: this.events,
      apiUsage24h: usage,
      tokenStatus,
      schedulers: {
        globalDailyMerge: !!this.systemRunners.globalDailyMerge,
        autoMergeService: !!this.systemRunners.autoMergeService,
        perProjectPipelines: Array.from(this.systemRunners.perProjectPipelines.keys())
      }
    };
  }
}

export const controlCenter = new ControlCenter();
