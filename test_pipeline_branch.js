import { listSources } from './src/api/julesClient.js';
async function run() {
    const res = await listSources('test', 100);
    console.log(JSON.stringify(res.sources.map(s => s.name)));
}
run().catch(console.error);
