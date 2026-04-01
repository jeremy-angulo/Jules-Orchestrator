import { createSession } from './src/api/julesClient.js';

async function test() {
    const res = await createSession(
        'test-agent',
        'Fix an issue in the docs',
        'Test Session',
        'sources/github/jeremy-angulo/HomeFreeWord',
        'main',
        'AUTO_CREATE_PR'
    );
    console.log(JSON.stringify(res, null, 2));
}

test().catch(console.error);
