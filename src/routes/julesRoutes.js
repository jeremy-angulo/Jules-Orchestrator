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

router.get('/sources/:sourceId(*)', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const data = await getSource('System', req.params.sourceId);
        if (!data) return res.status(404).json({ error: 'Source not found' });
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

// Historical Sessions (no runner attached)
router.get('/sessions/:sessionId(*)', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
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
