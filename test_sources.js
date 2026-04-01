import { getAvailableToken } from './src/api/tokenRotation.js';
import { listSources } from './src/api/julesClient.js';

async function test() {
    const sources = await listSources('test', 10);
    console.log(JSON.stringify(sources, null, 2));
}

test().catch(console.error);
