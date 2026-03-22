const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPOS = ['jeremy-angulo/HomeFreeWorld', 'jeremy-angulo/TrefleAI_IHM'];

async function checkPRs() {
    for (const repo of REPOS) {
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        const prs = await res.json();
        console.log(`[${repo}] Found ${prs.length} open PRs.`);
        prs.forEach(pr => console.log(`  - #${pr.number}: ${pr.title}`));
    }
}

checkPRs().catch(console.error);
