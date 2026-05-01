import { initTables, createAgent, upsertProjectConfig, createAssignment, listAgents, listProjectsConfig } from './src/db/database.js';
import fs from 'fs';
import 'dotenv/config';

async function main() {
  await initTables();

  const bootstrapData = JSON.parse(fs.readFileSync('./bootstrap.json', 'utf8'));
  
  const existingAgents = await listAgents();
  const existingProjects = await listProjectsConfig();

  if (existingAgents.length === 0 && existingProjects.length === 0) {
    console.log('Seeding initial data...');
    for (const agent of bootstrapData.agents || []) await createAgent(agent);
    for (const project of bootstrapData.projects || []) await upsertProjectConfig(project);
    for (const ass of bootstrapData.assignments || []) await createAssignment(ass);
  }

  // Add Lead SDET if missing
  const agents = await listAgents();
  if (!agents.find(a => a.name === 'lead-sdet')) {
    console.log('Adding lead-sdet agent...');
    const sdetPrompt = fs.readFileSync('./prompts/HomeFreeWorld/lead-sdet.md', 'utf8');
    const agentId = await createAgent({
      name: 'lead-sdet',
      description: 'Autonomous QA agent for fixing tests and improving coverage',
      prompt: sdetPrompt,
      color: '#fbbf24'
    });

    console.log('Assigning lead-sdet to HomeFreeWorld...');
    await createAssignment({
      project_id: 'HomeFreeWorld',
      agent_id: agentId,
      mode: 'loop',
      loop_pause_ms: 1800000,
      enabled: 1
    });
  }

  console.log('Done.');
}

main().catch(console.error);
