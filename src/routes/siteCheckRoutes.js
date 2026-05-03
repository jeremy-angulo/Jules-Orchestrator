import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, audit } from '../middleware/authMiddleware.js';
import {
  getSiteCheckConfig,
  getSiteCheckStats,
  listSitePages,
  releaseStaleSitePageLocks,
} from '../db/database.js';

const router = express.Router({ mergeParams: true }); // :projectId comes from parent

// GET /api/projects/:projectId/site-check
// Returns config + stats
router.get('/', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const [config, stats] = await Promise.all([
      getSiteCheckConfig(projectId),
      getSiteCheckStats(projectId),
    ]);
    res.json({
      config: config || { enabled: false, baseUrl: null, pauseMs: 5000 },
      stats,
      running: controlCenter.isSiteCheckRunning(projectId),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// POST /api/projects/:projectId/site-check/toggle
// Body: { enabled, baseUrl, pauseMs }
router.post('/toggle', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { enabled, baseUrl, pauseMs, locale, concurrency } = req.body || {};

    await controlCenter.toggleSiteCheck(projectId, !!enabled, baseUrl, pauseMs ?? 5000, locale ?? 'fr', concurrency ?? 1);
    await audit(req, 'site_check.toggle', projectId, { enabled, baseUrl, concurrency });

    const [config, stats] = await Promise.all([
      getSiteCheckConfig(projectId),
      getSiteCheckStats(projectId),
    ]);
    res.json({
      ok: true,
      config,
      stats,
      running: controlCenter.isSiteCheckRunning(projectId),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// GET /api/projects/:projectId/site-check/pages
// Query: ?status=OK|FIX|ANALYZE&locale=en|fr&group=platform&limit=100&offset=0
router.get('/pages', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { status, group, limit = 100, offset = 0 } = req.query;
    const pages = await listSitePages(projectId, {
      status,
      group,
      limit: Math.min(Number(limit), 500),
      offset: Number(offset),
    });
    res.json({ pages });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// POST /api/projects/:projectId/site-check/release-locks
// Emergency: release all stale locks
router.post('/release-locks', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
  try {
    const { maxAgeMinutes = 0 } = req.body || {};
    await releaseStaleSitePageLocks(Number(maxAgeMinutes));
    await audit(req, 'site_check.release_locks', req.params.projectId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

export default router;
