import { createClient } from '@libsql/client';
import fs from 'fs';
import 'dotenv/config';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('--- REMOTE SEED: Lead SDET ---');
  
  const agentsRs = await client.execute('SELECT * FROM agents');
  const agents = agentsRs.rows;

  if (!agents.find(a => a.name === 'lead-sdet')) {
    console.log('Adding lead-sdet agent to remote...');
    const sdetPrompt = fs.readFileSync('./prompts/HomeFreeWorld/lead-sdet.md', 'utf8');
    const rs = await client.execute({
      sql: 'INSERT INTO agents (name, description, prompt, color, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [
        'lead-sdet',
        'Autonomous QA agent for fixing tests and improving coverage',
        sdetPrompt,
        '#fbbf24',
        Date.now(),
        Date.now(),
        10
      ]
    });
    const agentId = Number(rs.lastInsertRowid);
    console.log(`Lead SDET added with ID: ${agentId}`);

    console.log('Assigning lead-sdet to HomeFreeWorld on remote...');
    await client.execute({
      sql: 'INSERT INTO assignments (project_id, agent_id, mode, loop_pause_ms, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [
        'HomeFreeWorld',
        agentId,
        'loop',
        1800000,
        1,
        Date.now(),
        Date.now()
      ]
    });
    console.log('Assignment created.');
  } else {
    console.log('lead-sdet already exists on remote.');
    const sdet = agents.find(a => a.name === 'lead-sdet');
    
    const assignmentsRs = await client.execute({
      sql: 'SELECT * FROM assignments WHERE project_id = ? AND agent_id = ?',
      args: ['HomeFreeWorld', sdet.id]
    });

    if (assignmentsRs.rows.length === 0) {
      console.log('Creating missing assignment for lead-sdet...');
      await client.execute({
        sql: 'INSERT INTO assignments (project_id, agent_id, mode, loop_pause_ms, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [
          'HomeFreeWorld',
          sdet.id,
          'loop',
          1800000,
          1,
          Date.now(),
          Date.now()
        ]
      });
      console.log('Assignment created.');
    } else {
      console.log('Assignment already exists for lead-sdet.');
    }
  }

  console.log('Done.');
}

main().catch(console.error);
