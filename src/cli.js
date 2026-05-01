
import 'dotenv/config';
import { listAgents, recordAgentSessionEnd } from './db/database.js';
import { createSession, sendMessage, approvePlan, deleteSession } from './api/julesClient.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = './prompts/HomeFreeWorld';

async function getAgents() {
  const dbAgents = await listAgents();
  const fsAgents = fs.readdirSync(PROMPTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = fs.readFileSync(path.join(PROMPTS_DIR, f), 'utf8');
      const name = f.replace('.md', '');
      return { name, description: `Filesystem agent: ${name}`, prompt: content };
    });
  
  return [...dbAgents, ...fsAgents];
}

function parseSessions(output) {
  const lines = output.split('\n').filter(l => l.trim() && !l.includes('ID') && !l.includes('---'));
  return lines.map(line => {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 2) return null;
    return {
      id: parts[0],
      description: parts[1],
      repo: parts[2],
      lastActive: parts[3],
      status: parts[4] || ''
    };
  }).filter(Boolean);
}

async function cleanup() {
  console.log('--- Jules Cleanup & Status ---');
  const listOutput = execSync('jules remote list --session', { encoding: 'utf8' });
  const sessions = parseSessions(listOutput);
  
  const stats = {
    keepGoing: 0,
    archived: 0,
    active: 0
  };

  for (const s of sessions) {
    const fullId = s.id.startsWith('sessions/') ? s.id : `sessions/${s.id}`;
    const agentName = s.description.split(' ')[0] || 'unknown';

    if (s.status.includes('Awaiting User')) {
      console.log(`[${s.id}] Waiting for input. Sending "keep going"...`);
      try {
        await approvePlan(agentName, fullId).catch(() => {});
        await sendMessage(agentName, fullId, 'keep going');
        stats.keepGoing++;
      } catch (err) {
        console.error(`Failed to message session ${s.id}: ${err.message}`);
      }
    } else if (s.status.includes('Completed') || s.status.includes('Failed') || s.status === '') {
      console.log(`[${s.id}] Finished or Error (${s.status}). Archiving (deleting remote)...`);
      try {
        await deleteSession(agentName, fullId);
        await recordAgentSessionEnd(fullId, 'archived').catch(() => {});
        stats.archived++;
      } catch (err) {
        console.error(`Failed to archive session ${s.id}: ${err.message}`);
      }
    } else {
      console.log(`[${s.id}] Active: ${s.status}`);
      stats.active++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`- Active: ${stats.active}`);
  console.log(`- Sent "keep going": ${stats.keepGoing}`);
  console.log(`- Archived: ${stats.archived}`);
}

async function launch(agentName, repo, task) {
  const agents = await getAgents();
  const agent = agents.find(a => a.name.toLowerCase().includes(agentName.toLowerCase()));
  
  if (!agent) {
    console.error(`Error: Agent "${agentName}" not found.`);
    console.log('Available agents:', agents.map(a => a.name).join(', '));
    process.exit(1);
  }

  let finalPrompt = agent.prompt;
  if (task) {
    finalPrompt = `TASK: ${task}\n\nROLE CONTEXT:\n${finalPrompt}`;
  }

  const repoFlag = repo && repo !== '.' ? `--repo ${repo}` : '';
  const command = `jules new ${repoFlag} "${finalPrompt.replace(/"/g, '\\"')}"`;
  
  console.log(`Launching agent: ${agent.name}...`);
  try {
    const output = execSync(command, { encoding: 'utf8' });
    console.log(output);
  } catch (err) {
    console.error(`Failed to launch Jules: ${err.message}`);
  }
}

const [,, cmd, ...args] = process.argv;

if (cmd === 'list-agents') {
  const agents = await getAgents();
  console.log(JSON.stringify(agents.map(a => ({ name: a.name, description: a.description })), null, 2));
} else if (cmd === 'cleanup') {
  await cleanup();
} else if (cmd === 'launch') {
  const [agent, repo, ...taskParts] = args;
  await launch(agent, repo, taskParts.join(' '));
} else {
  console.log('Usage: node src/cli.js <launch|cleanup|list-agents> [params]');
}
