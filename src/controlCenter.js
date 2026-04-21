import { PROJECTS } from './config.js';
import { sleepInterruptible } from './utils/helpers.js';
import { startAndMonitorSession } from './api/julesClient.js';
import { getNextGitHubIssue, closeGitHubIssue, mergeOpenPRs } from './api/githubClient.js';
import { formatIssueInstruction } from './agents/issueAgent.js';
import {
  scheduleBuildAndMergePipeline,
  scheduleGlobalDailyPRMergePipeline,
  scheduleAutoMergeService,
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
  getApiUsageSummary24h
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
  constructor(projects = PROJECTS) {
    this.projects = projects;
    this.projectById = new Map(projects.map((p) => [p.id, p]));
    this.runners = new Map();
    this.events = [];
    this.startedAt = nowIso();
    this.systemRunners = {
      globalDailyMerge: null,
      autoMergeService: null,
      perProjectPipelines: new Map()
    };
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

  getProject(projectId) {
    return this.projectById.get(projectId);
  }

  async init() {
    for (const project of this.projects) {
      await initProjectState(project.id);
    }
  }

  _buildProjectReadiness(project) {
    const tokenStatus = getTokenStatusSummary();
    const validPrompts = (project.backgroundPrompts || []).filter((prompt) => typeof prompt === 'string' && prompt.trim().length > 0);
    const hasGitHubToken = !!(project.githubToken || '').trim();
    const hasJulesToken = tokenStatus.configured;
    const readyForBackground = hasGitHubToken && hasJulesToken && validPrompts.length > 0;
    const readyForIssue = hasGitHubToken && hasJulesToken;

    const reasons = [];
    if (!hasGitHubToken) reasons.push('GITHUB_TOKEN missing');
    if (!hasJulesToken) reasons.push('Jules API key missing');
    if (validPrompts.length === 0) reasons.push('No valid background prompt loaded');

    return {
      hasGitHubToken,
      hasJulesToken,
      validBackgroundPrompts: validPrompts.length,
      readyForBackground,
      readyForIssue,
      reasons
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
      lastError: runner.lastError
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
      promise: null
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

  setRunnerKillAfter(runnerId, timeoutMs) {
    const runner = this.runners.get(runnerId);
    if (!runner) {
      return false;
    }
    const safeTimeout = Math.max(1000, Number(timeoutMs) || 0);
    runner.killAt = Date.now() + safeTimeout;
    runner.details = {
      ...runner.details,
      killAfterMs: safeTimeout
    };
    this.log('info', 'Runner kill timer set', { runnerId, timeoutMs: safeTimeout });
    return true;
  }

  stopRunner(runnerId) {
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

  stopBy(projectId, type = null) {
    let count = 0;
    for (const runner of this.runners.values()) {
      if (runner.projectId !== projectId) continue;
      if (type && runner.type !== type) continue;
      if (this.stopRunner(runner.id)) {
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

  async startConfiguredBackground(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const prompts = (project.backgroundPrompts || [])
      .map((prompt, index) => ({ prompt, index }))
      .filter((entry) => typeof entry.prompt === 'string' && entry.prompt.trim().length > 0);

    if (prompts.length === 0) {
      return [];
    }

    const started = [];
    for (const entry of prompts) {
      const index = entry.index;
      const prompt = entry.prompt;
      const runnerId = this.makeRunnerId(projectId, 'background', String(index));
      if (this.runners.has(runnerId)) {
        continue;
      }
      const runner = this._createRunner({
        id: runnerId,
        projectId,
        type: 'background',
        mode: 'loop',
        label: `Background ${index}`,
        intervalMs: DEFAULT_BG_PAUSE_MS,
        details: { promptIndex: index }
      });
      runner.promise = this._runLoop(
        runner,
        async () => {
          if (await isProjectLocked(projectId)) {
            await sleepInterruptible(LOCK_WAIT_MS, () => runner.shouldStop);
            return;
          }

          await incrementTasks(projectId);
          let mustDecrement = true;
          try {
            await startAndMonitorSession(prompt, `Background Agent - ${index}`, project, {
              shouldStop: () => runner.shouldStop,
              preferredTokenId: runner.details?.preferredTokenId || null
            });
          } finally {
            if (mustDecrement) {
              await decrementTasks(projectId);
            }
          }
        },
        DEFAULT_BG_PAUSE_MS
      );
      started.push(runnerId);
    }

    return started;
  }

  async runBackgroundOnce(projectId, prompt, label = 'Background Manual', options = {}) {
    const project = this.getProject(projectId);
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
          preferredTokenId: runner.details?.preferredTokenId || null
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

  async startIssueLoop(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const runnerId = this.makeRunnerId(projectId, 'issue');
    if (this.runners.has(runnerId)) {
      return runnerId;
    }

    const runner = this._createRunner({
      id: runnerId,
      projectId,
      type: 'issue',
      mode: 'loop',
      label: 'Issue Agent',
      intervalMs: 30000
    });

    runner.promise = this._runLoop(
      runner,
      async () => {
        if (await isProjectLocked(projectId)) {
          await sleepInterruptible(30000, () => runner.shouldStop);
          return;
        }

        const issue = await getNextGitHubIssue(project);
        if (!issue) {
          return;
        }

        await lockProject(projectId);
        await incrementTasks(projectId);
        try {
          while ((await getActiveTasks(projectId)) > 1 && !runner.shouldStop) {
            await sleepInterruptible(15000, () => runner.shouldStop);
          }

          if (runner.shouldStop) {
            return;
          }

          await mergeOpenPRs(project);
          const instruction = formatIssueInstruction(issue);
          const success = await startAndMonitorSession(instruction, 'Issue Agent', project, {
            shouldStop: () => runner.shouldStop
          });
          if (success) {
            await closeGitHubIssue(project, issue.number);
          }
        } finally {
          await decrementTasks(projectId);
          await unlockProject(projectId);
        }
      },
      30000
    );

    return runnerId;
  }

  async runIssueOnce(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    const issue = await getNextGitHubIssue(project);
    if (!issue) {
      return { started: false, message: 'No open issue available.' };
    }

    const runnerId = this.makeRunnerId(projectId, 'manual-issue', Date.now().toString());
    const runner = this._createRunner({
      id: runnerId,
      projectId,
      type: 'manual-issue',
      mode: 'once',
      label: `Manual Issue #${issue.number}`,
      details: { issueNumber: issue.number }
    });
    runner.keepInRegistryAfterStop = true;

    runner.promise = (async () => {
      await lockProject(projectId);
      await incrementTasks(projectId);
      try {
        const instruction = formatIssueInstruction(issue);
        const success = await startAndMonitorSession(instruction, 'Issue Agent', project, {
          shouldStop: () => runner.shouldStop
        });
        if (success) {
          await closeGitHubIssue(project, issue.number);
        }
        runner.iterations = 1;
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        this._markRunnerStopped(runner, 'failed', err);
      } finally {
        await decrementTasks(projectId);
        await unlockProject(projectId);
      }
    })();

    return { started: true, runnerId, issueNumber: issue.number };
  }

  async runPipelineNow(projectId) {
    const project = this.getProject(projectId);
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
        await runBuildAndMergePipelineOnce(project, { shouldStop: () => runner.shouldStop });
        runner.iterations = 1;
        this._markRunnerStopped(runner, 'completed');
      } catch (err) {
        this._markRunnerStopped(runner, 'failed', err);
      }
    })();

    return runnerId;
  }

  async startCustomLoop(projectId, prompt, label = 'Custom Loop', intervalMs = 120000, options = {}) {
    const project = this.getProject(projectId);
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
    if (!this.getProject(projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    if (locked) {
      await lockProject(projectId);
    } else {
      await unlockProject(projectId);
    }
  }

  async resetProjectTasks(projectId) {
    if (!this.getProject(projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    await setActiveTasks(projectId, 0);
  }

  async stopAll() {
    for (const runnerId of Array.from(this.runners.keys())) {
      this.stopRunner(runnerId);
    }
  }

  async startSchedulers() {
    if (!this.systemRunners.globalDailyMerge) {
      const task = scheduleGlobalDailyPRMergePipeline(this.projects);
      this.systemRunners.globalDailyMerge = task;
      this.log('info', 'Global daily merge scheduler started');
    }

    if (!this.systemRunners.autoMergeService) {
      const task = scheduleAutoMergeService(this.projects);
      this.systemRunners.autoMergeService = task;
      this.log('info', 'Auto-merge scheduler started');
    }

    for (const project of this.projects) {
      if (!project.buildAndMergePipeline) continue;
      if (this.systemRunners.perProjectPipelines.has(project.id)) continue;
      const task = scheduleBuildAndMergePipeline(project);
      this.systemRunners.perProjectPipelines.set(project.id, task);
      this.log('info', 'Project pipeline scheduler started', { projectId: project.id });
    }
  }

  stopSchedulers() {
    if (this.systemRunners.globalDailyMerge) {
      this.systemRunners.globalDailyMerge.stop();
      this.systemRunners.globalDailyMerge = null;
    }
    if (this.systemRunners.autoMergeService) {
      this.systemRunners.autoMergeService.stop();
      this.systemRunners.autoMergeService = null;
    }
    for (const [projectId, task] of this.systemRunners.perProjectPipelines.entries()) {
      task.stop();
      this.systemRunners.perProjectPipelines.delete(projectId);
    }
  }

  stopGlobalDailyMergeScheduler() {
    if (!this.systemRunners.globalDailyMerge) {
      return false;
    }
    this.systemRunners.globalDailyMerge.stop();
    this.systemRunners.globalDailyMerge = null;
    this.log('info', 'Global daily merge scheduler stopped');
    return true;
  }

  startGlobalDailyMergeScheduler() {
    if (this.systemRunners.globalDailyMerge) {
      return false;
    }
    this.systemRunners.globalDailyMerge = scheduleGlobalDailyPRMergePipeline(this.projects);
    this.log('info', 'Global daily merge scheduler started');
    return true;
  }

  stopAutoMergeScheduler() {
    if (!this.systemRunners.autoMergeService) {
      return false;
    }
    this.systemRunners.autoMergeService.stop();
    this.systemRunners.autoMergeService = null;
    this.log('info', 'Auto-merge scheduler stopped');
    return true;
  }

  startAutoMergeScheduler() {
    if (this.systemRunners.autoMergeService) {
      return false;
    }
    this.systemRunners.autoMergeService = scheduleAutoMergeService(this.projects);
    this.log('info', 'Auto-merge scheduler started');
    return true;
  }

  stopProjectPipelineScheduler(projectId) {
    const task = this.systemRunners.perProjectPipelines.get(projectId);
    if (!task) {
      return false;
    }
    task.stop();
    this.systemRunners.perProjectPipelines.delete(projectId);
    this.log('info', 'Project pipeline scheduler stopped', { projectId });
    return true;
  }

  startProjectPipelineScheduler(projectId) {
    const project = this.getProject(projectId);
    if (!project || !project.buildAndMergePipeline) {
      return false;
    }
    if (this.systemRunners.perProjectPipelines.has(projectId)) {
      return false;
    }
    const task = scheduleBuildAndMergePipeline(project);
    this.systemRunners.perProjectPipelines.set(projectId, task);
    this.log('info', 'Project pipeline scheduler started', { projectId });
    return true;
  }

  async startDefaultLoops() {
    for (const project of this.projects) {
      if (!project.githubRepo) continue;
      const readiness = this._buildProjectReadiness(project);
      if (readiness.readyForBackground) {
        await this.startConfiguredBackground(project.id);
      } else {
        this.log('info', 'Background loops skipped (project not ready)', {
          projectId: project.id,
          reasons: readiness.reasons
        });
      }

      if (readiness.readyForIssue) {
        await this.startIssueLoop(project.id);
      } else {
        this.log('info', 'Issue loop skipped (project not ready)', {
          projectId: project.id,
          reasons: readiness.reasons
        });
      }
    }
  }

  async startAll() {
    await this.init();
    await this.startDefaultLoops();
    await this.startSchedulers();
  }

  getStatus() {
    const states = getAllProjectStates();
    const usage = getApiUsageSummary24h();

    const projects = this.projects.map((project) => {
      const readiness = this._buildProjectReadiness(project);
      const state = states.find((s) => s.projectId === project.id) || {
        projectId: project.id,
        is_locked_for_daily: false,
        active_tasks: 0
      };
      return {
        id: project.id,
        githubRepo: project.githubRepo,
        githubBranch: project.githubBranch,
        hasPipeline: !!project.buildAndMergePipeline,
        backgroundPromptCount: Array.isArray(project.backgroundPrompts) ? project.backgroundPrompts.length : 0,
        validBackgroundPromptCount: readiness.validBackgroundPrompts,
        locked: state.is_locked_for_daily,
        activeTasks: state.active_tasks,
        readiness
      };
    });

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
