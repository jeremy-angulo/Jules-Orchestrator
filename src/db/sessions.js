import { executeWithRetry } from './core.js';

export async function recordAgentSessionStart({ assignmentId, projectId, agentName, sessionId, tokenIndex = null }) {
  const now = Date.now();
  await executeWithRetry({ 
    sql: 'INSERT INTO agent_sessions (session_id, assignment_id, project_id, agent_name, token_index, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
    args: [sessionId, assignmentId, projectId, agentName, tokenIndex, now, now] 
  });
}

export async function recordAgentSessionEnd(sid, status) {
  await executeWithRetry({ sql: 'UPDATE agent_sessions SET status = ?, ended_at = ? WHERE session_id = ?', args: [status, Date.now(), sid] });
}

export async function getAgentSessionsByStatus(status) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM agent_sessions WHERE status = ?', args: [status] });
  return rs.rows;
}

export async function listAgentSessions(pid) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50', args: [pid] });
  return rs.rows;
}

export async function getLastAgentSession(aid) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM agent_sessions WHERE assignment_id = ? ORDER BY started_at DESC LIMIT 1', args: [aid] });
  return rs.rows[0];
}

// ── Journal ───────────────────────────────────────────────────────────────────

export async function createJournalEntry({ sessionId, assignmentId, projectId, agentName, intent }) {
  await executeWithRetry({
    sql: `INSERT INTO journal (session_id, assignment_id, project_id, agent_name, intent, status, started_at)
          VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    args: [sessionId, assignmentId ?? null, projectId, agentName, intent ?? null, Date.now()],
  });
}

export async function closeJournalEntry(sessionId, { summary, status, prUrl = null, metadata = null } = {}) {
  await executeWithRetry({
    sql: `UPDATE journal
          SET summary = ?, status = ?, pr_url = ?, ended_at = ?, metadata = ?
          WHERE session_id = ?`,
    args: [
      summary ?? null,
      status ?? 'completed',
      prUrl ?? null,
      Date.now(),
      metadata ? JSON.stringify(metadata) : null,
      sessionId,
    ],
  });
}

export async function getJournalEntry(sessionId) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM journal WHERE session_id = ?', args: [sessionId] });
  const row = rs.rows[0];
  if (!row) return null;
  return { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null };
}

export async function listJournalByProject(projectId, limit = 50) {
  const rs = await executeWithRetry({
    sql: 'SELECT * FROM journal WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
    args: [projectId, limit],
  });
  return rs.rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

export async function listJournalByAssignment(assignmentId, limit = 20) {
  const rs = await executeWithRetry({
    sql: 'SELECT * FROM journal WHERE assignment_id = ? ORDER BY started_at DESC LIMIT ?',
    args: [assignmentId, limit],
  });
  return rs.rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}
