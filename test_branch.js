import { PROJECTS } from './src/config.js';

async function test() {
    const p1 = PROJECTS.find(p => p.id === 'Pipeline-CAC40');
    console.log(`Checking GitHub branch for ${p1.githubRepo}...`);
    const res = await fetch(`https://api.github.com/repos/${p1.githubRepo}`, {
        headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!res.ok) {
        console.error(res.status, await res.text());
        return;
    }
    const data = await res.json();
    console.log(`Default branch is: ${data.default_branch}`);
}

test().catch(console.error);
