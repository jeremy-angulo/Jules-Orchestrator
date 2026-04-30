import express from 'express';
import { 
    listDashboardUsers, 
    updateDashboardUserRole, 
    deleteDashboardUser, 
    createDashboardUser 
} from '../auth/dashboardAuth.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, audit } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', apiRateLimiter, requirePermission('users.read'), async (req, res) => {
    try {
        const users = await listDashboardUsers();
        res.status(200).json({ users });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/', apiRateLimiter, requirePermission('users.manage'), async (req, res) => {
    const { email, password, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const user = await createDashboardUser(email, password, role || 'viewer');
        await audit(req, 'user.create', String(user.id), { email, role });
        res.status(201).json({ ok: true, user });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.patch('/:id', apiRateLimiter, requirePermission('users.manage'), async (req, res) => {
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: 'Role required' });
    try {
        const user = await updateDashboardUserRole(req.params.id, role);
        await audit(req, 'user.update', req.params.id, { role });
        res.status(200).json({ ok: true, user });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.delete('/:id', apiRateLimiter, requirePermission('users.manage'), async (req, res) => {
    try {
        await deleteDashboardUser(req.params.id);
        await audit(req, 'user.delete', req.params.id);
        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

export default router;
