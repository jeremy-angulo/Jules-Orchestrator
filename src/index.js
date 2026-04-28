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

controlCenter.init().then(async () => {
  console.log('ControlCenter initialized.');
  await controlCenter.startAllAssignments();
  console.log('Assignment runners started.');
}).catch((err) => {
  console.error('Fatal error while initializing ControlCenter:', err);
});
