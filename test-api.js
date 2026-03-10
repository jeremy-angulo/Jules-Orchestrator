import { julesAPI } from './src/api/julesClient.js';
import { GLOBAL_CONFIG } from './src/config.js';

GLOBAL_CONFIG.JULES_API_TOKEN = 'AQ.Ab8RN6LqBUldiIGNt_zW8hJLHqfdaisC_8LDwAJseq9c8v9tXg';

async function test() {
  console.log('Testing Jules API...');
  const res = await julesAPI('/sessions', 'POST', { prompt: 'Test' });
  console.log('Response:', res);
}

test();
