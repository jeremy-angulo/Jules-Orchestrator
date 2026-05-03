import { executeWithRetry } from './core.js';

export async function listTokenNames() {
  const rs = await executeWithRetry('SELECT * FROM token_names');
  return rs.rows;
}

export async function getTokenName(idx) {
  const rs = await executeWithRetry({ sql: 'SELECT custom_name FROM token_names WHERE token_index = ?', args: [idx] });
  return rs.rows[0]?.custom_name || null;
}

export async function upsertTokenName(idx, name) {
  await executeWithRetry({ sql: 'INSERT INTO token_names (token_index, custom_name) VALUES (?, ?) ON CONFLICT(token_index) DO UPDATE SET custom_name = excluded.custom_name', args: [idx, name] });
}
