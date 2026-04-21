import 'dotenv/config';
import app from './app.js';
import { controlCenter } from './controlCenter.js';
import { GLOBAL_CONFIG } from './config.js';

// Serveur de santé pour Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
});

if (GLOBAL_CONFIG.MOCK_MODE) {
  controlCenter.init().then(() => {
    console.log('ControlCenter initialized in mock mode (no agents started).');
  }).catch((err) => {
    console.error('Fatal error while initializing ControlCenter in mock mode:', err);
  });
} else {
  controlCenter.startAll().catch((err) => {
    console.error('Fatal error while starting ControlCenter:', err);
  });
}
