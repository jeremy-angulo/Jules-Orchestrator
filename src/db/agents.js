import { executeWithRetry } from './core.js';
import { agentListCache, invalidateAgentCache } from './cache.js';

export async function listAgents() {
  if (agentListCache.data) return agentListCache.data;
  const rs = await executeWithRetry('SELECT * FROM agents ORDER BY sort_order ASC, name ASC');
  agentListCache.data = rs.rows;
  return rs.rows;
}

export async function getAgent(id) {
  const agents = await listAgents();
  return agents.find(a => String(a.id) === String(id));
}

export async function createAgent(a) {
  let rs;
  if (a.id) {
    rs = await executeWithRetry({ sql: 'INSERT INTO agents (id, name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [a.id, a.name, a.description, a.prompt, a.color, a.sort_order || 0, Date.now(), Date.now()] });
  } else {
    rs = await executeWithRetry({ sql: 'INSERT INTO agents (name, description, prompt, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [a.name, a.description, a.prompt, a.color, a.sort_order || 0, Date.now(), Date.now()] });
  }
  invalidateAgentCache();
  return rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : (a.id || null);
}

export async function updateAgent(id, a) {
  await executeWithRetry({ sql: 'UPDATE agents SET name=?, description=?, prompt=?, color=?, updated_at=? WHERE id=?', args: [a.name, a.description, a.prompt, a.color, Date.now(), id] });
  invalidateAgentCache();
}

export async function deleteAgent(id) {
  await executeWithRetry({ sql: 'DELETE FROM agents WHERE id = ?', args: [id] });
  invalidateAgentCache();
}

export async function reorderAgents(ids) {
  for (let i = 0; i < ids.length; i++) {
    await executeWithRetry({ sql: 'UPDATE agents SET sort_order = ? WHERE id = ?', args: [i, ids[i]] });
  }
  invalidateAgentCache();
}
