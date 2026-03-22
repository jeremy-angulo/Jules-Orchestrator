import https from 'https';

const token = process.env.GITHUB_TOKEN;
const repos = ['jeremy-angulo/HomeFreeWorld', 'jeremy-angulo/TrefleAI_IHM'];

const get = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'Node.js',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
};

async function main() {
    for (const repo of repos) {
        console.log(`\nChecking ${repo}...`);
        const prs = await get(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`);
        console.log(`Found ${prs.length} open PRs`);
        for (const pr of prs) {
            console.log(`- PR #${pr.number}: ${pr.title}`);
        }
    }
}
main();
