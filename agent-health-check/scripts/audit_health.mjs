import { controlCenter } from '../../src/controlCenter.js';
import { listAssignments } from '../../src/db/database.js';

async function audit() {
  await controlCenter.init();
  const assignments = await listAssignments();
  const runners = controlCenter.listRunners();

  console.log('--- Agent Health Audit ---');
  let issues = 0;
  for (const a of assignments) {
    if (!a.enabled) continue;
    const activeRunners = runners.filter(r => 
      r.type === 'assignment-loop' && 
      r.details.assignmentId === a.id && 
      r.status === 'running'
    );
    
    const concurrency = a.concurrency || 1;
    if (activeRunners.length !== concurrency) {
      console.log(`[Issue] Assignment ${a.id} (${a.agent_name}): Expected ${concurrency} runners, found ${activeRunners.length}`);
      issues++;
    }
  }
  
  if (issues === 0) console.log('✅ System healthy.');
}

audit().catch(console.error);
