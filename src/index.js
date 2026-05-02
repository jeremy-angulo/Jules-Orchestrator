import 'dotenv/config';
import app from './app.js';
import { controlCenter } from './controlCenter.js';
import { setControlCenterForLogger } from './utils/logger.js';
import { startWebsiteHealthMonitor } from './services/healthMonitor.js';
import { initTables } from './db/database.js';

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
    await controlCenter.startAllSiteChecks();
  } catch (err) {
    console.error('Fatal error while starting ControlCenter:', err);
  }
}

main().catch(err => {
  console.error('Unhandled fatal error during startup:', err);
  process.exit(1);
});
