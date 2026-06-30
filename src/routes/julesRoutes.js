import express from 'express';
import {
    listSources,
    getSource,
    getSession,
    listActivities
} from '../api/julesClient.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/sources', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const data = await listSources('System', 100);
        res.status(200).json(data || { sources: [] });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/sources/:id', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const data = await getSource('System', req.params.id);
        if (!data) return res.status(404).json({ error: 'Source not found' });
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/sessions/:id', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const data = await getSession('System', req.params.id);
        if (!data) return res.status(404).json({ error: 'Session not found' });
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/sessions/:id/activities', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const data = await listActivities('System', req.params.id, 100);
        res.status(200).json(data || { activities: [] });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

export default router;
