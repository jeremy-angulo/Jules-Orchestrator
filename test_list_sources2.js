import { listSources } from './src/api/julesClient.js';

async function test() {
    let pageToken = undefined;
    while (true) {
        const res = await listSources('test', 100, pageToken);
        if (!res || !res.sources) break;

        for (const source of res.sources) {
            console.log(source.name);
        }

        pageToken = res.nextPageToken;
        if (!pageToken) break;
    }
}

test().catch(console.error);
