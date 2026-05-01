import { controlCenter } from '../../src/controlCenter.js';
import { listAssignments } from '../../src/db/database.js';

async function heal() {
  await controlCenter.init();
  const assignments = await listAssignments();
  const runners = controlCenter.listRunners();

  console.log('--- Healing System ---');
  for (const a of assignments) {
    if (!a.enabled) continue;
    
    // Stop hung runners for this assignment
    const activeRunners = runners.filter(r => 
      r.type === 'assignment-loop' && 
      r.details.assignmentId === a.id && 
      r.status === 'running'
    );
    
    const concurrency = a.concurrency || 1;
    if (activeRunners.length > concurrency) {
       console.log(`[Heal] Killing ${activeRunners.length - concurrency} orphaned runners for assignment ${a.id}`);
       for (let i = 0; i < (activeRunners.length - concurrency); i++) {
         await controlCenter.stopRunner(activeRunners[i].id);
       }
    } else if (activeRunners.length < concurrency) {
       console.log(`[Heal] Restarting assignment ${a.id} (found ${activeRunners.length}/${concurrency})`);
       await controlCenter.startAssignment(a.id);
    }
  }
  console.log('✅ Healing complete.');
}

heal().catch(console.error);
