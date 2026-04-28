import express from 'express';
import { controlCenter } from '../controlCenter.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';
import { requirePermission, requireCriticalConfirmation, audit } from '../middleware/authMiddleware.js';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent, reorderAgents } from '../db/database.js';

const router = express.Router();

router.get('/', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    res.status(200).json({ agents: await listAgents() });
});

router.post('/', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const { name, description, prompt, color } = req.body || {};
    if (!name?.trim() || !prompt?.trim()) return res.status(400).json({ error: 'name and prompt are required.' });
    try {
        await createAgent({ name, description, prompt, color });
        const all = await listAgents();
        const agent = all.find(a => a.name === name);
        await audit(req, 'agent.create', String(agent?.id), { name });
        res.status(201).json({ ok: true, agent });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

router.get('/:id', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const agent = await getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    res.status(200).json(agent);
});

router.put('/:id', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const { name, description, prompt, color } = req.body || {};
    await updateAgent(req.params.id, { name, description, prompt, color });
    const agent = await getAgent(req.params.id);
    await audit(req, 'agent.update', req.params.id, { name: agent.name });
    res.status(200).json({ ok: true, agent });
});

router.delete('/:id', apiRateLimiter, requirePermission('agents.control'), requireCriticalConfirmation, async (req, res) => {
    const agent = await getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    await deleteAgent(req.params.id);
    await audit(req, 'agent.delete', req.params.id, { name: agent.name });
    res.status(200).json({ ok: true });
});

router.post('/reorder', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    await reorderAgents(ids);
    await audit(req, 'agents.reorder', 'multiple', { ids });
    res.status(200).json({ ok: true });
});

// One-shot execution
router.post('/run-once/:projectId/:agentId', apiRateLimiter, requirePermission('background.runOnce'), async (req, res) => {
    const { projectId, agentId } = req.params;
    const { instructions, media } = req.body || {};
    try {
        const runnerId = await controlCenter.runAgentOnce(projectId, agentId === 'custom' ? 'custom' : Number(agentId), { instructions, media });
        await audit(req, 'agent.runOnce', projectId, { agentId, runnerId });
        res.status(202).json({ ok: true, runnerId });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

export default router;
