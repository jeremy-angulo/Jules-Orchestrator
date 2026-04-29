import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { listSources, getSource, getSession, listActivities } from '../api/julesClient.js';
import { mergeOpenPRs, closePR, mergePRWithResult } from '../api/githubClient.js';
import { getCachedPRs, invalidatePRCache } from '../services/githubService.js';
import { 
    listAgentSessions, 
    upsertProjectConfig, 
    getProjectConfig, 
    deleteProjectConfig, 
    deleteAssignmentsByProject,
    listAssignments,
    toggleAssignment,
    createAssignment,
    deleteAssignment,
    listAgents,
    getAgent,
    createAgent,
    updateAgent,
    deleteAgent,
    reorderAgents,
    recordDashboardMetric,
    listDashboardMetrics,
    listAuditEvents,
    getServiceErrorSummary,
    listServiceChecks,
    listServiceErrors,
    getServiceUptime
} from '../db/database.js';
import { getTokenStatusSummary } from '../api/tokenRotation.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, requireCriticalConfirmation, audit } from '../middleware/authMiddleware.js';

import projectRoutes from './projectRoutes.js';
import agentRoutes from './agentRoutes.js';
import assignmentRoutes from './assignmentRoutes.js';
import systemRoutes from './systemRoutes.js';
import julesRoutes from './julesRoutes.js';

const router = express.Router();

// Register modular routes
router.use('/projects', projectRoutes);
router.use('/agents', agentRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/system', systemRoutes);
router.use('/jules', julesRoutes);

// Helper
async function getProjectOrFail(projectId, res) {
    const project = await controlCenter.getProjectRuntime(projectId);
    if (!project) {
        res.status(404).json({ error: `Unknown project: ${projectId}` });
        return null;
    }
    return project;
}

// ==========================================
// SYSTEM & STATUS
// ==========================================

router.get('/status', async (req, res) => {
    let payload = await controlCenter.getStatus();
    payload.currentUser = req.dashboardUser;
    await recordDashboardMetric('active_runners', payload.runners.length);
    res.status(200).json(payload);
});

router.get('/health-status', requirePermission('keys.read'), async (req, res) => {
    const hours = Math.max(1, Number(req.query.hours || 24));
    const external = String(process.env.WEBSITE_HEALTH_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
    const websiteUrl = external || (req.protocol + '://' + req.get('host') + '/health');

    const buildService = async (serviceId, label) => {
        const summary = await getServiceErrorSummary(serviceId, hours);
        const checks = await listServiceChecks(serviceId, 40);
        const latestCheck = checks[0] || null;
        return {
            id: serviceId,
            label,
            status: summary.errors > 0 ? 'degraded' : 'operational',
            errors: summary.errors,
            latencyMs: latestCheck?.responseMs ?? null,
            lastCheckedAt: latestCheck ? new Date(latestCheck.timestamp).toISOString() : null,
            recentErrors: await listServiceErrors(serviceId, hours, 20)
        };
    };

    const services = await Promise.all([
        buildService('github_api', 'GitHub API'),
        buildService('jules_api', 'Jules API'),
        buildService('website', 'Orchestrator Health')
    ]);

    const website = services[2];
    const uptime7d = await getServiceUptime('website', 24 * 7);
    website.ping = {
        url: websiteUrl,
        uptime7d: uptime7d.uptimePercent,
        checks: (await listServiceChecks('website', 30)).slice().reverse().map(c => !!c.ok)
    };

    res.status(200).json({ hours, services });
});

// ==========================================
// JULES & SESSIONS
// ==========================================

router.get(/^\/sessions\/(.*)/, requirePermission('dashboard.read'), async (req, res) => {
    try {
        let rawId = req.params[0];
        // Handle double encoding or prefixing from frontend
        let sessionId = decodeURIComponent(rawId);
        if (sessionId.startsWith('sessions/')) {
            sessionId = sessionId.replace('sessions/', '');
        }

        // Try to find the session. We might not know the exact agent name, 
        // but getSession will try Jules API. 'System' is our default fallback.
        const [session, activitiesRes] = await Promise.all([
            getSession('System', sessionId).catch(() => null),
            listActivities('System', sessionId, 100).catch(() => null),
        ]);

        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.status(200).json({ session, activities: activitiesRes?.activities || [] });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});


// ==========================================
// PROJECTS
// ==========================================

router.get('/projects/config', requirePermission('dashboard.read'), async (req, res) => {
    res.status(200).json({ projects: await listProjectsConfig() });
});

router.post('/projects/config', requirePermission('projects.add'), async (req, res) => {
    const { id, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt } = req.body || {};
    try {
        await upsertProjectConfig({ id, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt });
        await controlCenter.init();
        await audit(req, 'project.upsert', id, { github_repo });
        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/projects/:projectId/detail', async (req, res) => {
    const { projectId } = req.params;
    const project = await controlCenter.getProjectRuntime(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const allRunners = controlCenter.listRunners();
    const projectRunners = allRunners.filter(r => r.projectId === projectId);
    res.status(200).json({
        projectId,
        project,
        runners: {
            running: projectRunners.filter(r => r.status === 'running'),
            completed: projectRunners.filter(r => r.status === 'stopped' && !r.lastError),
            failed: projectRunners.filter(r => r.lastError)
        }
    });
});

router.get('/projects/:projectId/prs', requirePermission('dashboard.read'), async (req, res) => {
    const project = await getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    try {
        const prs = await getCachedPRs(project);
        res.status(200).json({ prs });
    } catch (e) {
        res.status(500).json({ error: String(e.message) });
    }
});

router.post('/projects/:projectId/prs/close-batch', requirePermission('prs.merge'), async (req, res) => {
    const project = await getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    const { prNumbers } = req.body || {};
    const results = [];
    for (const prNumber of prNumbers) {
        try {
            await closePR(project, Number(prNumber));
            results.push({ prNumber: Number(prNumber), status: 'closed' });
        } catch (err) {
            results.push({ prNumber: Number(prNumber), status: 'failed', error: err.message });
        }
    }
    invalidatePRCache(project.id);
    res.status(200).json({ results });
});

router.get('/projects/:projectId/assignments', requirePermission('dashboard.read'), async (req, res) => {
    const assignments = await listAssignments(req.params.projectId);
    const enriched = assignments.map(a => ({ ...a, running: controlCenter.isAssignmentRunning(a.id) }));
    res.status(200).json({ assignments: enriched });
});

// ==========================================
// AGENTS
// ==========================================

router.get('/agents', requirePermission('agents.control'), async (req, res) => {
    res.status(200).json({ agents: await listAgents() });
});

router.post('/agents', requirePermission('agents.control'), async (req, res) => {
    const { name, description, prompt, color } = req.body || {};
    await createAgent({ name, description, prompt, color });
    res.status(201).json({ ok: true });
});

// ==========================================
// ASSIGNMENTS
// ==========================================

router.get('/assignments', requirePermission('dashboard.read'), async (req, res) => {
    const assignments = await listAssignments(req.query.projectId || null);
    const enriched = assignments.map(a => ({ ...a, running: controlCenter.isAssignmentRunning(a.id) }));
    res.status(200).json({ assignments: enriched });
});

router.post('/assignments', requirePermission('agents.control'), async (req, res) => {
    const { project_id, agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge } = req.body || {};
    await createAssignment({ project_id, agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge });
    const all = await listAssignments(project_id);
    const assignment = all[all.length - 1];
    await controlCenter.startAssignment(assignment.id);
    res.status(201).json({ ok: true });
});

router.post('/assignments/:id/toggle', requirePermission('agents.control'), async (req, res) => {
    const id = Number(req.params.id);
    const current = await getAssignment(id);
    if (!current) return res.status(404).json({ error: 'Assignment not found' });
    const newEnabled = !current.enabled;
    await toggleAssignment(id, newEnabled);
    if (newEnabled) await controlCenter.startAssignment(id);
    else await controlCenter.stopAssignment(id);
    res.status(200).json({ ok: true });
});

// ==========================================
// RUNNERS
// ==========================================

router.get('/runners/:runnerId/session', requirePermission('dashboard.read'), async (req, res) => {
    const runner = controlCenter.runners.get(req.params.runnerId);
    if (!runner) return res.status(404).json({ error: 'Runner not found.' });
    const snapshot = controlCenter.getRunnerSnapshot(runner);
    if (!snapshot.sessionId) return res.status(200).json({ runner: snapshot, session: null, activities: [] });
    try {
        const agentName = runner.details?.agentName || 'Agent';
        const [session, activitiesRes] = await Promise.all([
            getSession(agentName, snapshot.sessionId).catch(() => null),
            listActivities(agentName, snapshot.sessionId, 100).catch(() => null),
        ]);
        res.status(200).json({ runner: snapshot, session, activities: activitiesRes?.activities || [] });
    } catch (e) {
        res.status(200).json({ runner: snapshot, session: null, activities: [], error: e.message });
    }
});

router.post('/runners/:runnerId/stop', requirePermission('runners.stop'), requireCriticalConfirmation, async (req, res) => {
    await controlCenter.stopRunner(req.params.runnerId);
    res.status(200).json({ ok: true });
});

// ==========================================
// AUDIT & ANALYTICS
// ==========================================

router.get('/audit-events', requirePermission('audit.read'), async (req, res) => {
    res.status(200).json({ events: await listAuditEvents() });
});

router.get('/analytics/metrics', requirePermission('analytics.read'), async (req, res) => {
    const hours = Number(req.query.hours || 24);
    const series = {};
    for (const key of ['active_runners', 'active_tasks', 'locked_projects']) {
        series[key] = await listDashboardMetrics(key, hours);
    }
    res.status(200).json({ hours, series });
});

export default router;
