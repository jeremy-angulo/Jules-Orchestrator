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
import userRoutes from './userRoutes.js';

const router = express.Router();

// Register modular routes
router.use('/projects', projectRoutes);
router.use('/agents', agentRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/jules', julesRoutes);
router.use('/users', userRoutes);
router.use('/', systemRoutes);

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

export default router;
