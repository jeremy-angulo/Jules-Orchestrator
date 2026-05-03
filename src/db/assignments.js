import { executeWithRetry } from './core.js';
import { assignmentListCache, invalidateAssignmentCache } from './cache.js';

export async function listAssignments(pid = null) {
  const cacheKey = pid || 'all';
  if (assignmentListCache.has(cacheKey)) return assignmentListCache.get(cacheKey);

  const sql = `
    SELECT a.*, ag.name as agent_name, ag.color as agent_color 
    FROM assignments a 
    LEFT JOIN agents ag ON a.agent_id = ag.id
    ${pid ? 'WHERE a.project_id = ?' : ''}
    ORDER BY a.created_at ASC
  `;
  const q = pid ? { sql, args: [pid] } : { sql, args: [] };
  const rs = await executeWithRetry(q);
  assignmentListCache.set(cacheKey, rs.rows);
  return rs.rows;
}

export async function getAssignment(id) {
  const rs = await executeWithRetry({ 
    sql: `
      SELECT a.*, ag.name as agent_name, ag.color as agent_color 
      FROM assignments a 
      LEFT JOIN agents ag ON a.agent_id = ag.id 
      WHERE a.id = ?
    `, 
    args: [id] 
  });
  return rs.rows[0];
}

export async function createAssignment(a) {
  const rs = await executeWithRetry({ sql: 'INSERT INTO assignments (project_id, agent_id, mode, loop_pause_ms, cron_schedule, enabled, concurrency, created_at, updated_at, custom_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [a.project_id, a.agent_id, a.mode, a.loop_pause_ms, a.cron_schedule, a.enabled !== undefined ? (a.enabled ? 1 : 0) : 1, a.concurrency || 1, Date.now(), Date.now(), a.custom_prompt] });
  invalidateAssignmentCache(a.project_id);
  return rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : null;
}

export async function updateAssignment(id, a) {
  const rs = await executeWithRetry({ sql: 'UPDATE assignments SET agent_id=?, custom_prompt=?, mode=?, loop_pause_ms=?, cron_schedule=?, enabled=?, concurrency=?, updated_at=? WHERE id=? RETURNING project_id', args: [a.agent_id, a.custom_prompt, a.mode, a.loop_pause_ms, a.cron_schedule, a.enabled ? 1 : 0, a.concurrency || 1, Date.now(), id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}

export async function deleteAssignment(id) {
  const rs = await executeWithRetry({ sql: 'DELETE FROM assignments WHERE id = ? RETURNING project_id', args: [id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}

export async function deleteAssignmentsByProject(pid) {
  await executeWithRetry({ sql: 'DELETE FROM assignments WHERE project_id = ?', args: [pid] });
  invalidateAssignmentCache(pid);
}

export async function toggleAssignment(id, enabled) {
  const rs = await executeWithRetry({ sql: 'UPDATE assignments SET enabled = ?, updated_at = ? WHERE id = ? RETURNING project_id', args: [enabled ? 1 : 0, Date.now(), id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}

export async function recordAssignmentRun(id) {
  const rs = await executeWithRetry({ sql: 'UPDATE assignments SET last_run_at = ?, total_runs = total_runs + 1 WHERE id = ? RETURNING project_id', args: [Date.now(), id] });
  invalidateAssignmentCache(rs.rows[0]?.project_id);
}
