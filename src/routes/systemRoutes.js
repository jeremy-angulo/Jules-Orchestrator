import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, requireCriticalConfirmation, audit } from '../middleware/authMiddleware.js';
import {
    listAuditEvents,
    listTokenNames,
    upsertTokenName,
} from '../db/database.js';
import {
    listDashboardMetricsBatch,
    getServiceErrorSummary,
    listServiceChecks,
    listServiceErrors,
    getServiceUptime,
    recordServiceCheck,
} from '../services/metricsStore.js';
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
    try {
        let payload = await controlCenter.getStatus();
        payload.currentUser = req.dashboardUser;
        // Metrics are written by the statsInterval (every 5 min), not on every poll.
        res.status(200).json(payload);
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

// Cache health-status for 60s — it's monitoring data, sub-minute freshness not needed.
let _healthStatusCache = null;
let _healthStatusCachedAt = 0;
const HEALTH_CACHE_MS = 60_000;

router.get('/health-status', apiRateLimiter, requirePermission('keys.read'), async (req, res) => {
    try {
        const hours = Math.max(1, Number(req.query.hours || 24));
        const now = Date.now();
        if (_healthStatusCache && (now - _healthStatusCachedAt) < HEALTH_CACHE_MS && _healthStatusCache.hours === hours) {
            return res.status(200).json(_healthStatusCache);
        }

        const external = String(process.env.WEBSITE_HEALTH_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
        const websiteUrl = external || (req.protocol + '://' + req.get('host') + '/health');

        const buildService = async (serviceId, label) => {
            const [summary, checks, recentErrors] = await Promise.all([
                getServiceErrorSummary(serviceId, hours),
                listServiceChecks(serviceId, 40),
                listServiceErrors(serviceId, hours, 20),
            ]);
            const latestCheck = checks[0] || null;
            return {
                id: serviceId,
                label,
                status: summary.errors > 0 ? 'degraded' : 'operational',
                errors: summary.errors,
                windowHours: hours,
                latencyMs: latestCheck?.responseMs ?? null,
                lastCheckedAt: latestCheck ? new Date(latestCheck.timestamp).toISOString() : null,
                recentErrors,
            };
        };

        const [services, uptime7d] = await Promise.all([
            Promise.all([
                buildService('github_api', 'GitHub API'),
                buildService('jules_api', 'Jules API'),
                buildService('website', 'Orchestrator Health'),
            ]),
            getServiceUptime('website', 24 * 7),
        ]);

        const website = services[2];
        const recentChecks = await listServiceChecks('website', 30);
        website.ping = {
            url: websiteUrl,
            uptime7d: uptime7d.uptimePercent,
            checks: recentChecks.slice().reverse().map(c => !!c.ok),
        };

        const payload = { hours, services };
        _healthStatusCache = payload;
        _healthStatusCachedAt = now;
        res.status(200).json(payload);
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
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
    const series = await listDashboardMetricsBatch(['active_runners', 'active_tasks', 'locked_projects'], hours);
    res.status(200).json({ hours, series });
});

router.get('/keys', apiRateLimiter, requirePermission('keys.read'), async (req, res) => {
    try {
        res.status(200).json(await getTokenStatusSummary());
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/token-names', apiRateLimiter, requirePermission('keys.read'), async (req, res) => {
    try {
        res.status(200).json({ tokenNames: await listTokenNames() });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
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
