import { createClient } from '@libsql/client';
import 'dotenv/config';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('--- REMOTE DB: Projects Config ---');
  const projects = await client.execute('SELECT * FROM projects_config');
  console.table(projects.rows);

  console.log('\n--- REMOTE DB: Agents ---');
  const agents = await client.execute('SELECT * FROM agents');
  console.table(agents.rows);

  console.log('\n--- REMOTE DB: Assignments ---');
  const assignments = await client.execute('SELECT * FROM assignments');
  console.table(assignments.rows);
}

main().catch(console.error);
