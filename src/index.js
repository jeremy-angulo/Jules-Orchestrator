import 'dotenv/config';
import app from './app.js';
import { controlCenter } from './controlCenter.js';
import { GLOBAL_CONFIG } from './config.js';
import { startWebsiteHealthMonitor } from './services/healthMonitor.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Orchestrator listening on port ${PORT}`);
});

startWebsiteHealthMonitor();

if (process.env.BOOTSTRAP_DATA) {
  try {
    const data = JSON.parse(process.env.BOOTSTRAP_DATA);
    const { createAgent, upsertProjectConfig, createAssignment, listAgents, listProjectsConfig } = await import('./db/database.js');
    
    // Only bootstrap if DB is empty
    if (listAgents().length === 0 && listProjectsConfig().length === 0) {
      console.log('[Bootstrap] Empty database detected. Importing data from BOOTSTRAP_DATA...');
      
      for (const agent of data.agents || []) {
        createAgent(agent);
      }
      for (const project of data.projects || []) {
        upsertProjectConfig(project);
      }
      for (const ass of data.assignments || []) {
        createAssignment(ass);
      }
      console.log('[Bootstrap] Database populated successfully.');
    }
  } catch (err) {
    console.error('[Bootstrap] Failed to parse or apply BOOTSTRAP_DATA:', err);
  }
}

controlCenter.init().then(async () => {
  console.log('ControlCenter initialized.');
  await controlCenter.startAllAssignments();
  console.log('Assignment runners started.');
}).catch((err) => {
  console.error('Fatal error while initializing ControlCenter:', err);
});
