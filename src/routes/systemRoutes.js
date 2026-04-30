import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, requireCriticalConfirmation, audit } from '../middleware/authMiddleware.js';
import { 
    recordDashboardMetric, 
    listDashboardMetrics, 
    listAuditEvents, 
    getServiceErrorSummary, 
    listServiceChecks, 
    listServiceErrors, 
    getServiceUptime,
    recordServiceCheck,
    listTokenNames,
    upsertTokenName
} from '../db/database.js';
import { getTokenStatusSummary } from '../api/tokenRotation.js';
import { getSession, listActivities } from '../api/julesClient.js';

const router = express.Router();

router.get('/runners/:runnerId/session', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
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

router.post('/runners/:runnerId/stop', apiRateLimiter, requirePermission('runners.stop'), requireCriticalConfirmation, async (req, res) => {
    const ok = await controlCenter.stopRunner(req.params.runnerId);
    if (!ok) return res.status(404).json({ error: 'Runner not found.' });
    await audit(req, 'runner.stop', req.params.runnerId);
    res.status(200).json({ ok: true, runnerId: req.params.runnerId });
});

router.post('/start', apiRateLimiter, requirePermission('system.control'), async (req, res) => {
    try {
        await controlCenter.startAll();
        await audit(req, 'system.start', 'all');
        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/stop', apiRateLimiter, requirePermission('system.control'), requireCriticalConfirmation, async (req, res) => {
    try {
        await controlCenter.stopAll();
        await audit(req, 'system.stop', 'all');
        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/status', apiRateLimiter, async (req, res) => {
    let payload = await controlCenter.getStatus();
    payload.currentUser = req.dashboardUser;
    await recordDashboardMetric('active_runners', payload.runners.length);
    await recordDashboardMetric('active_tasks', payload.projects.reduce((sum, p) => sum + p.activeTasks, 0));
    await recordDashboardMetric('locked_projects', payload.projects.filter((p) => p.locked).length);
    res.status(200).json(payload);
});

router.get('/health-status', apiRateLimiter, requirePermission('keys.read'), async (req, res) => {
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
            windowHours: hours,
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

router.get('/logs', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    const status = await controlCenter.getStatus();
    res.status(200).json({ logs: status.events });
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

router.get('/keys', apiRateLimiter, requirePermission('keys.read'), async (req, res) => {
    res.status(200).json(await getTokenStatusSummary());
});

router.get('/token-names', apiRateLimiter, requirePermission('keys.read'), async (req, res) => {
    res.status(200).json({ tokenNames: await listTokenNames() });
});

router.put('/token-names/:tokenIndex', apiRateLimiter, requirePermission('keys.manage'), async (req, res) => {
    const tokenIndex = Number(req.params.tokenIndex);
    const { customName } = req.body || {};
    if (!customName) return res.status(400).json({ error: 'Custom name required' });
    await upsertTokenName(tokenIndex, customName);
    await audit(req, 'token.rename', `token-${tokenIndex}`, { customName });
    res.status(200).json({ ok: true });
});

export default router;
