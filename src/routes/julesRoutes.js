import express from 'express';
import { listSources, getSource, getSession, listActivities } from '../api/julesClient.js';
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

export default router;
