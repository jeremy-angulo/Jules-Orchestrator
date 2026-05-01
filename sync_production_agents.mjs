import { createClient } from '@libsql/client';
import fs from 'fs';
import 'dotenv/config';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('--- REMOTE SYNC: Production & UI Agents ---');
  
  const agentsRs = await client.execute('SELECT * FROM agents');
  const agents = agentsRs.rows;

  const targetAgents = [
    { name: 'lead-product-engineer', file: './prompts/HomeFreeWorld/lead-product-engineer.md', color: '#6366f1' },
    { name: 'qa-desktop', file: './bootstrap.json', isBootstrap: true, id: 15 },
    { name: 'qa-mobile', file: './bootstrap.json', isBootstrap: true, id: 16 }
  ];

  const bootstrapData = JSON.parse(fs.readFileSync('./bootstrap.json', 'utf8'));

  for (const target of targetAgents) {
    let agent = agents.find(a => a.name === target.name);
    let agentId;

    if (!agent) {
      console.log(`Adding ${target.name} to remote...`);
      let prompt;
      if (target.isBootstrap) {
        prompt = bootstrapData.agents.find(a => a.name === target.name).prompt;
      } else {
        // Correct path for local repo check
        const localPath = `../Jules-Orchestrator/prompts/HomeFreeWorld/${target.name}.md`;
        prompt = fs.readFileSync(localPath, 'utf8');
      }

      const rs = await client.execute({
        sql: 'INSERT INTO agents (name, description, prompt, color, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [
          target.name,
          target.isBootstrap ? bootstrapData.agents.find(a => a.name === target.name).description : 'Micro-improvement cycle for product gaps',
          prompt,
          target.color || '#3f8cff',
          Date.now(),
          Date.now(),
          20
        ]
      });
      agentId = Number(rs.lastInsertRowid);
    } else {
      agentId = agent.id;
      console.log(`${target.name} already exists (ID: ${agentId})`);
    }

    const assignmentsRs = await client.execute({
      sql: 'SELECT * FROM assignments WHERE project_id = ? AND agent_id = ?',
      args: ['HomeFreeWorld', agentId]
    });

    if (assignmentsRs.rows.length === 0) {
      console.log(`Creating loop assignment for ${target.name}...`);
      await client.execute({
        sql: 'INSERT INTO assignments (project_id, agent_id, mode, loop_pause_ms, enabled, wait_for_pr_merge, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          'HomeFreeWorld',
          agentId,
          'loop',
          1800000, // 30 mins
          1,
          1, // Wait for PR merge to keep it clean
          Date.now(),
          Date.now()
        ]
      });
    } else {
      console.log(`Assignment for ${target.name} already exists.`);
    }
  }

  console.log('Done.');
}

main().catch(console.error);
