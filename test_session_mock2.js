import { createSession } from './src/api/julesClient.js';
import { PROJECTS } from './src/config.js';

async function test() {
    const p2 = PROJECTS.find(p => p.id === 'HomeFreeWord');

    console.log(`Source 2: sources/github-${p2.githubRepo.replace(/\//g, '-')}`);

    const res2 = await createSession(
        'test-agent',
        'test',
        'Test Session 2',
        `sources/github-${p2.githubRepo.replace(/\//g, '-')}`,
        p2.githubBranch,
        'AUTO_CREATE_PR'
    );
    console.log('Res 2:', res2 ? res2.name : res2);
}

test().catch(console.error);
