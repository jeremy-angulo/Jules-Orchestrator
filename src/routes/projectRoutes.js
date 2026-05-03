import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { getSource } from '../api/julesClient.js';
import { mergeOpenPRs } from '../api/githubClient.js';
import { getCachedPRs, invalidatePRCache } from '../services/githubService.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, requireCriticalConfirmation, audit } from '../middleware/authMiddleware.js';
import {
    listAgentSessions,
    upsertProjectConfig,
    getProjectConfig,
    listProjectsConfig,
    deleteProjectConfig,
    deleteAssignmentsByProject,
    listAssignments,
    createAssignment,
    getAssignment,
    listJournalByProject
} from '../db/database.js';
import { mergePRWithResult, closePR } from '../api/githubClient.js';

const router = express.Router();

async function getProjectOrFail(projectId, res) {
    const project = await controlCenter.getProjectRuntime(projectId);
    if (!project) {
        res.status(404).json({ error: `Unknown project: ${projectId}` });
        return null;
    }
    return project;
}

router.get('/config', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    try {
        const projects = await listProjectsConfig();
        res.status(200).json({ projects });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/config', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    const { 
        id, github_repo, github_branch, github_token, 
        pipeline_cron, pipeline_prompt, build_pipeline_enabled,
        conflict_resolver_enabled, conflict_resolver_cron
    } = req.body || {};
    if (!id?.trim() || !github_repo?.trim()) return res.status(400).json({ error: 'id and github_repo are required.' });
    try {
        await upsertProjectConfig({ 
            id, github_repo, github_branch, github_token, 
            pipeline_cron, pipeline_prompt, build_pipeline_enabled,
            conflict_resolver_enabled, conflict_resolver_cron 
        });
        const row = await getProjectConfig(id);
        
        // Refresh ControlCenter runtime and restart schedulers to apply changes
        await controlCenter.init();
        await controlCenter.stopSchedulers();
        await controlCenter.startSchedulers();
        
        await audit(req, 'project.upsert', id, { github_repo });
        res.status(200).json({ ok: true, project: row });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/:projectId/detail', apiRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.params;
        const project = await controlCenter.getProjectRuntime(projectId);
        if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

        const allRunners = controlCenter.listRunners();
        const projectRunners = allRunners.filter(r => r.projectId === projectId);
        const running = projectRunners.filter(r => r.status === 'running');
        const completed = projectRunners.filter(r => r.status === 'stopped' && !r.lastError && r.stoppedAt);
        const failed = projectRunners.filter(r => r.lastError || (r.status === 'stopped' && r.lastError));
        const status = await controlCenter.getStatus();
        const sortByTime = (a, b) => (new Date(b.stoppedAt || b.startedAt).getTime()) - (new Date(a.stoppedAt || a.startedAt).getTime());

        const projectState = status.projects.find(p => p.id === projectId) || {};

        res.status(200).json({
            projectId,
            project: {
                id: project.id,
                githubRepo: project.githubRepo,
                githubBranch: project.githubBranch,
                locked: projectState.locked,
                lockedAt: projectState.lockedAt,
                lockReason: projectState.lockReason,
                hasPipeline: !!project.buildAndMergePipeline,
                buildAndMergePipeline: project.buildAndMergePipeline,
                buildPipelineEnabled: project.buildPipelineEnabled,
                conflictResolverEnabled: project.conflictResolverEnabled,
                conflictResolverCron: project.conflictResolverCron
            },
            runners: { running: running.sort(sortByTime), completed: completed.sort(sortByTime), failed: failed.sort(sortByTime) },
            summary: { total: projectRunners.length, runningCount: running.length, completedCount: completed.length, failedCount: failed.length }
        });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/add', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        let { repoPath, sourceId } = req.body || {};
        if (!repoPath) return res.status(400).json({ error: 'repoPath is required' });
        if (!sourceId) sourceId = `github/${repoPath}`;
        
        const source = await getSource('System', sourceId);
        if (!source || !source.githubRepo) return res.status(404).json({ error: `Source ${repoPath} not found in Jules.` });

        const repoData = source.githubRepo;
        const projectId = repoData.repo;

        if (await controlCenter.getProjectRuntime(projectId)) return res.status(409).json({ error: `Project ${projectId} is already connected.` });

        const newProject = {
            id: projectId,
            githubRepo: repoPath,
            githubBranch: repoData.defaultBranch?.displayName || 'main',
            githubToken: process.env.GITHUB_TOKEN,
            backgroundPrompts: []
        };

        await upsertProjectConfig({
            id: newProject.id,
            github_repo: newProject.githubRepo,
            github_branch: newProject.githubBranch,
            github_token: newProject.githubToken
        });
        
        await controlCenter.init(); // Refresh CC
        await audit(req, 'projects.add', projectId, { repoPath });
        res.status(201).json({ ok: true, project: newProject });
    } catch (error) {
        res.status(500).json({ error: String(error?.message || error) });
    }
});

router.get('/:projectId/sessions', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    const sessions = await listAgentSessions(req.params.projectId);
    res.status(200).json({ sessions });
});

router.get('/:projectId/journal', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const entries = await listJournalByProject(req.params.projectId, limit);
        res.status(200).json({ journal: entries });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/:projectId/assignments', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    try {
        const assignments = await listAssignments(req.params.projectId);
        const enriched = assignments.map(a => ({ ...a, running: controlCenter.isAssignmentRunning(a.id) }));
        res.status(200).json({ assignments: enriched });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/:projectId/assignments', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const { projectId } = req.params;
    const { agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge } = req.body || {};
    try {
        const id = await createAssignment({ 
            project_id: projectId, 
            agent_id, 
            custom_prompt, 
            mode, 
            loop_pause_ms, 
            cron_schedule, 
            wait_for_pr_merge 
        });
        const assignment = await getAssignment(id);
        if (!assignment) throw new Error('Failed to retrieve newly created assignment');
        
        await controlCenter.startAssignment(assignment.id);
        await audit(req, 'assignment.create', String(assignment.id), { projectId, mode });
        res.status(201).json({ ok: true, assignment: { ...assignment, running: controlCenter.isAssignmentRunning(assignment.id) } });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/:projectId/lock', apiRateLimiter, requirePermission('project.lock'), requireCriticalConfirmation, async (req, res) => {
    const { projectId } = req.params;
    if (!await getProjectOrFail(projectId, res)) return;
    await controlCenter.setProjectLock(projectId, true);
    await audit(req, 'project.lock', projectId);
    res.status(200).json({ ok: true, projectId, locked: true });
});

router.post('/:projectId/unlock', apiRateLimiter, requirePermission('project.lock'), requireCriticalConfirmation, async (req, res) => {
    const { projectId } = req.params;
    if (!await getProjectOrFail(projectId, res)) return;
    await controlCenter.setProjectLock(projectId, false);
    await audit(req, 'project.unlock', projectId);
    res.status(200).json({ ok: true, projectId, locked: false });
});

router.post('/:projectId/tasks/reset', apiRateLimiter, requirePermission('project.resetTasks'), requireCriticalConfirmation, async (req, res) => {
    const { projectId } = req.params;
    if (!await getProjectOrFail(projectId, res)) return;
    await controlCenter.resetProjectTasks(projectId);
    await audit(req, 'project.tasks.reset', projectId);
    res.status(200).json({ ok: true, projectId, activeTasks: 0 });
});

router.put('/:projectId', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    const { projectId } = req.params;
    const { github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt } = req.body || {};
    if (!github_repo?.trim()) return res.status(400).json({ error: 'github_repo is required.' });
    try {
        await upsertProjectConfig({ id: projectId, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt });
        const row = await getProjectConfig(projectId);
        await controlCenter.init();
        await audit(req, 'project.update', projectId, { github_repo });
        res.status(200).json({ ok: true, project: row });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.delete('/:projectId/delete', apiRateLimiter, requirePermission('projects.delete'), requireCriticalConfirmation, async (req, res) => {
    const { projectId } = req.params;
    try {
        await deleteProjectConfig(projectId);
        await deleteAssignmentsByProject(projectId);
        await controlCenter.removeProject(projectId);
        await audit(req, 'project.delete', projectId);
        res.status(200).json({ ok: true, projectId });
    } catch (error) {
        res.status(500).json({ error: String(error?.message || error) });
    }
});

router.get('/:projectId/prs', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    const project = await getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    try {
        const prs = await getCachedPRs(project);
        res.status(200).json({ prs });
    } catch (e) {
        res.status(500).json({ error: String(e.message) });
    }
});

router.post('/:projectId/prs/merge-batch', apiRateLimiter, requirePermission('prs.merge'), async (req, res) => {
    const project = await getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    const { prNumbers } = req.body || {};
    if (!Array.isArray(prNumbers)) return res.status(400).json({ error: 'prNumbers array is required' });
    const results = [];
    for (const prNumber of prNumbers) {
        const result = await mergePRWithResult(project, Number(prNumber));
        results.push({ prNumber: Number(prNumber), ...result });
        await audit(req, 'pr.merge', String(prNumber), { projectId: project.id, status: result.status });
    }
    invalidatePRCache(project.id);
    res.status(200).json({ results });
});

router.post('/:projectId/prs/close-batch', apiRateLimiter, requirePermission('prs.merge'), async (req, res) => {
    const project = await getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    const { prNumbers } = req.body || {};
    if (!Array.isArray(prNumbers)) return res.status(400).json({ error: 'prNumbers array is required' });
    const results = [];
    for (const prNumber of prNumbers) {
        try {
            await closePR(project, Number(prNumber));
            results.push({ prNumber: Number(prNumber), status: 'closed' });
            await audit(req, 'pr.close', String(prNumber), { projectId: project.id });
        } catch (err) {
            results.push({ prNumber: Number(prNumber), status: 'failed', error: err.message });
        }
    }
    invalidatePRCache(project.id);
    res.status(200).json({ results });
});

router.post('/:projectId/pipeline/run', apiRateLimiter, requirePermission('pipelines.run'), async (req, res) => {
    const { projectId } = req.params;
    try {
        const runnerId = await controlCenter.runPipelineNow(projectId);
        await audit(req, 'pipeline.run', projectId, { runnerId });
        res.status(202).json({ ok: true, runnerId });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/:projectId/batch-conflict/run', apiRateLimiter, requirePermission('pipelines.run'), async (req, res) => {
    const { projectId } = req.params;
    try {
        const runnerId = await controlCenter.runBatchConflictNow(projectId);
        await audit(req, 'batch-conflict.run', projectId, { runnerId });
        res.status(202).json({ ok: true, runnerId });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

export default router;
