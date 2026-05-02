import 'dotenv/config';
import app from './app.js';
import { controlCenter } from './controlCenter.js';
import { setControlCenterForLogger } from './utils/logger.js';
import { startWebsiteHealthMonitor } from './services/healthMonitor.js';
import { initTables, getAllProjectStates, setActiveTasks } from './db/database.js';

setControlCenterForLogger(controlCenter);

const PORT = process.env.PORT || 3000;

async function main() {
  console.log('[Main] Initializing database...');
  await initTables();
  console.log('[Main] Database ready.');

  // Start the server only AFTER DB is ready
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Orchestrator listening on port ${PORT}`);
  });

  // Start health monitor
  startWebsiteHealthMonitor();

  if (process.env.BOOTSTRAP_DATA) {
    try {
      const data = JSON.parse(process.env.BOOTSTRAP_DATA);
      const { createAgent, upsertProjectConfig, createAssignment, listAgents, listProjectsConfig } = await import('./db/database.js');
      
      const existingAgents = await listAgents();
      const existingProjects = await listProjectsConfig();

      if (existingAgents.length === 0 && existingProjects.length === 0) {
        console.log('[Bootstrap] Empty database detected. Importing data from BOOTSTRAP_DATA...');
        for (const agent of data.agents || []) await createAgent(agent);
        for (const project of data.projects || []) await upsertProjectConfig(project);
        for (const ass of data.assignments || []) await createAssignment(ass);
        console.log('[Bootstrap] Database populated successfully.');
      }
    } catch (err) {
      console.error('[Bootstrap] Failed to parse or apply BOOTSTRAP_DATA:', err);
    }
  }

  try {
    await controlCenter.init();
    console.log('ControlCenter initialized.');

    // Reset stale active_tasks left over from a crashed/redeployed process
    const projectStates = await getAllProjectStates();
    await Promise.all(projectStates.map(s => setActiveTasks(s.projectId, 0)));
    console.log(`[Main] Reset active_tasks to 0 for ${projectStates.length} project(s).`);

    await controlCenter.startSchedulers();
    console.log('Schedulers started.');
    await controlCenter.startAllAssignments();
    console.log('Assignments started.');
    await controlCenter.startAllSiteChecks();
    console.log('Site checks started.');
  } catch (err) {
    console.error('Fatal error while starting ControlCenter:', err);
  }
}

main().catch(err => {
  console.error('Unhandled fatal error during startup:', err);
  process.exit(1);
});
