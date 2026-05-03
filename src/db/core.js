import { createClient } from '@libsql/client';

const isTestEnv = process.env.NODE_ENV === 'test';

const dbPath = process.env.ORCHESTRATOR_DB_PATH || (isTestEnv ? 'test-orchestrator.db' : 'orchestrator.db');
const url = (isTestEnv || !process.env.TURSO_DATABASE_URL)
  ? `file:${dbPath}`
  : process.env.TURSO_DATABASE_URL;
const authToken = isTestEnv ? undefined : process.env.TURSO_AUTH_TOKEN;

export const client = createClient({
  url,
  authToken,
});

export async function executeWithRetry(stmt, retries = 10, delay = 1000) {
  const normalizedStmt = typeof stmt === 'string' ? stmt : {
    ...stmt,
    args: stmt.args ? stmt.args.map(a => a === undefined ? null : a) : []
  };
  for (let i = 0; i < retries; i++) {
    try {
      return await client.execute(normalizedStmt);
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

export async function batchWithRetry(stmts, mode, retries = 10, delay = 1000) {
  const normalizedStmts = stmts.map(stmt => {
    if (typeof stmt === 'string') return stmt;
    return {
      ...stmt,
      args: stmt.args ? stmt.args.map(a => a === undefined ? null : a) : []
    };
  });
  for (let i = 0; i < retries; i++) {
    try {
      return await client.batch(normalizedStmts, mode);
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Prune rows older than N days from high-volume append-only tables.
// Run periodically (e.g. every 6h) to prevent unbounded table growth and full-table scans.
export async function pruneOldData(daysToKeep = 7) {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const results = {};
  const tables = [
    { table: 'audit_log',    col: 'timestamp' },
    { table: 'agent_sessions', col: 'started_at' },
  ];
  for (const { table, col } of tables) {
    try {
      const r = await executeWithRetry({ sql: `DELETE FROM ${table} WHERE ${col} < ?`, args: [cutoff] });
      results[table] = r.rowsAffected;
    } catch (e) {
      results[table] = `error: ${e.message}`;
    }
  }
  return results;
}
