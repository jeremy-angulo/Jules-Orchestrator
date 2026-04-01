import { getSource } from './src/api/julesClient.js';

async function test() {
    const source = await getSource('test', 'sources/github-jeremy-angulo-Pipeline-CAC40');
    console.log(JSON.stringify(source, null, 2));
}

test().catch(console.error);
