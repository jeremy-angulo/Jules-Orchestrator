import crypto from 'node:crypto';
process.env.NODE_ENV = 'test';
if (!process.env.ORCHESTRATOR_DB_PATH) {
  process.env.ORCHESTRATOR_DB_PATH = `test-db-${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`;
}
