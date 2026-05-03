import { executeWithRetry } from './core.js';

export async function recordAuditEvent(evt) {
  await executeWithRetry({ sql: 'INSERT INTO audit_log (timestamp, user_id, user_email, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [Date.now(), evt.userId, evt.userEmail, evt.action, evt.target, evt.details ? JSON.stringify(evt.details) : null, evt.ip] });
}

export async function listAuditEvents(hours = 24, limit = 200) {
  const rs = await executeWithRetry({ sql: 'SELECT * FROM audit_log WHERE timestamp >= ? ORDER BY id DESC LIMIT ?', args: [Date.now() - (hours * 3600000), limit] });
  return rs.rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}
