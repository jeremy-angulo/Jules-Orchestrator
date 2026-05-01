import { createClient } from '@libsql/client';

const client = createClient({
  url: 'file:../Jules-Orchestrator/orchestrator.db',
});

async function main() {
  console.log('--- Projects Config ---');
  const projects = await client.execute('SELECT * FROM projects_config');
  console.table(projects.rows);

  console.log('\n--- Agents ---');
  const agents = await client.execute('SELECT * FROM agents');
  console.table(agents.rows);

  console.log('\n--- Assignments ---');
  const assignments = await client.execute('SELECT * FROM assignments');
  console.table(assignments.rows);

  console.log('\n--- Active Sessions ---');
  const sessions = await client.execute('SELECT * FROM agent_sessions WHERE status = "running"');
  console.table(sessions.rows);
}

main().catch(console.error);
