import { createSession } from './src/api/julesClient.js';
import { PROJECTS } from './src/config.js';

async function test() {
    const p1 = PROJECTS.find(p => p.id === 'Pipeline-CAC40');
    const p2 = PROJECTS.find(p => p.id === 'HomeFreeWord');

    console.log(`Source 1: sources/github-${p1.githubRepo.replace(/\//g, '-')}`);
    console.log(`Source 2: sources/github-${p2.githubRepo.replace(/\//g, '-')}`);

    const res1 = await createSession(
        'test-agent',
        'test',
        'Test Session 1',
        `sources/github-${p1.githubRepo.replace(/\//g, '-')}`,
        p1.githubBranch,
        'AUTO_CREATE_PR'
    );
    console.log('Res 1:', res1.name); // Should print a session name

    const res2 = await createSession(
        'test-agent',
        'test',
        'Test Session 2',
        `sources/github-${p2.githubRepo.replace(/\//g, '-')}`,
        p2.githubBranch,
        'AUTO_CREATE_PR'
    );
    console.log('Res 2:', res2.name); // Should print a session name
}

test().catch(console.error);
