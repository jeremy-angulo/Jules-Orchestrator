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

router.get('/audit-events', apiRateLimiter, requirePermission('audit.read'), async (req, res) => {
    const hours = Number(req.query.hours || 24);
    const limit = Number(req.query.limit || 200);
    res.status(200).json({ events: await listAuditEvents(hours, limit) });
});

router.get('/analytics/metrics', apiRateLimiter, requirePermission('analytics.read'), async (req, res) => {
    const hours = Number(req.query.hours || 24);
    const series = {};
    for (const key of ['active_runners', 'active_tasks', 'locked_projects']) {
        series[key] = await listDashboardMetrics(key, hours);
    }
    res.status(200).json({ hours, series });
});

export default router;
