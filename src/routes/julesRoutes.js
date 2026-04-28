import express from 'express';
import { listSources, getSource, getSession, listActivities } from '../api/julesClient.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission } from '../middleware/authMiddleware.js';

const router = express.Router();

// Sources
router.get('/sources', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const data = await listSources('System', 100);
        res.status(200).json(data || { sources: [] });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

// Use regex for wildcard parameters in Express 5 to avoid path-to-regexp v8 strictness
router.get(/^\/sources\/(.*)/, apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const sourceId = req.params[0];
        const data = await getSource('System', sourceId);
        if (!data) return res.status(404).json({ error: 'Source not found' });
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

// Historical Sessions (no runner attached)
router.get(/^\/sessions\/(.*)/, apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    try {
        const sessionId = req.params[0];
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

export default router;
