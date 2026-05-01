import { initTables, listAgents, listProjectsConfig, listAssignments } from './src/db/database.js';
import 'dotenv/config';

async function main() {
  console.log('Initializing tables...');
  await initTables();
  
  console.log('\n--- Agents ---');
  const agents = await listAgents();
  console.table(agents);

  console.log('\n--- Projects ---');
  const projects = await listProjectsConfig();
  console.table(projects);

  console.log('\n--- Assignments ---');
  const assignments = await listAssignments();
  console.table(assignments);
}

main().catch(console.error);
