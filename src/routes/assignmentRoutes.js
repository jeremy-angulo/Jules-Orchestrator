import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, requireCriticalConfirmation, audit } from '../middleware/authMiddleware.js';
import { listAssignments, getAssignment, createAssignment, updateAssignment, deleteAssignment, toggleAssignment } from '../db/database.js';

const router = express.Router();

router.get('/', apiRateLimiter, async (req, res) => {
    const assignments = await listAssignments(req.query.projectId || null);
    const enriched = assignments.map(a => ({ ...a, running: controlCenter.isAssignmentRunning(a.id) }));
    res.status(200).json({ assignments: enriched });
});

router.post('/', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const { project_id, agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge } = req.body || {};
    try {
        await createAssignment({ project_id, agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge });
        const all = await listAssignments(project_id);
        const assignment = all[all.length - 1];
        await controlCenter.startAssignment(assignment.id);
        await audit(req, 'assignment.create', String(assignment.id), { project_id, mode });
        res.status(201).json({ ok: true, assignment: { ...assignment, running: controlCenter.isAssignmentRunning(assignment.id) } });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.post('/:id/toggle', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const id = Number(req.params.id);
    const current = await getAssignment(id);
    if (!current) return res.status(404).json({ error: 'Assignment not found.' });
    
    const newEnabled = !current.enabled;
    await toggleAssignment(id, newEnabled);
    const updated = await getAssignment(id);
    
    if (newEnabled) {
        try { await controlCenter.startAssignment(id); } catch (_) {}
    } else {
        await controlCenter.stopAssignment(id);
    }
    
    await audit(req, 'assignment.toggle', String(id), { enabled: newEnabled });
    res.status(200).json({ ok: true, assignment: { ...updated, running: controlCenter.isAssignmentRunning(id) } });
});

router.post('/:id/run', apiRateLimiter, requirePermission('background.runOnce'), async (req, res) => {
    try {
        const runnerId = await controlCenter.runAssignmentOnce(Number(req.params.id));
        await audit(req, 'assignment.runOnce', req.params.id, { runnerId });
        res.status(202).json({ ok: true, runnerId });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.put('/:id', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const id = Number(req.params.id);
    const { agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge, enabled } = req.body || {};
    
    const current = await getAssignment(id);
    if (!current) return res.status(404).json({ error: 'Assignment not found.' });

    try {
        await updateAssignment(id, { 
            agent_id, 
            custom_prompt, 
            mode, 
            loop_pause_ms, 
            cron_schedule, 
            wait_for_pr_merge, 
            enabled: enabled !== undefined ? enabled : current.enabled 
        });
        
        const updated = await getAssignment(id);
        
        // If it was running, we must restart it to apply new config
        if (updated.enabled) {
            await controlCenter.stopAssignment(id);
            await controlCenter.startAssignment(id);
        } else {
            await controlCenter.stopAssignment(id);
        }

        await audit(req, 'assignment.update', String(id), { mode });
        res.status(200).json({ ok: true, assignment: { ...updated, running: controlCenter.isAssignmentRunning(id) } });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.delete('/:id', apiRateLimiter, requirePermission('agents.control'), requireCriticalConfirmation, async (req, res) => {
    const id = Number(req.params.id);
    await controlCenter.stopAssignment(id);
    await deleteAssignment(id);
    await audit(req, 'assignment.delete', String(id));
    res.status(200).json({ ok: true });
});

export default router;
