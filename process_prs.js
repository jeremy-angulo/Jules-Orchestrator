import { execSync } from 'child_process';
import https from 'https';

const token = process.env.GITHUB_TOKEN;
const repo = 'jeremy-angulo/TrefleAI_IHM';

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
  try {
    const prs = await get(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`);
    console.log(`Found ${prs.length} open PRs`);

    // Sort oldest first
    prs.sort((a, b) => a.number - b.number);

    for (const pr of prs) {
      const { number, head: { ref: branch }, base: { ref: base } } = pr;
      console.log(`\nProcessing PR #${number}: ${branch} -> ${base}`);

      // Update local base again to ensure we have the latest
      execSync(`git fetch origin ${base}`, { stdio: 'inherit' });
      execSync(`git checkout -f ${base}`, { stdio: 'inherit' });
      execSync(`git reset --hard origin/${base}`, { stdio: 'inherit' });

      // Fetch the PR branch
      execSync(`git fetch origin ${branch}`, { stdio: 'inherit' });

      // Merge PR branch into base, favoring theirs
      try {
        console.log(`Merging ${branch} into ${base}...`);
        execSync(`git merge -X theirs origin/${branch} -m "Merge PR #${number}"`, { stdio: 'inherit' });
      } catch (e) {
        console.log(`Conflicts! Resolving by favoring theirs...`);
        // Handle files still marked as unmerged
        try {
            // Unmerged files
            const unmergedFiles = execSync('git diff --name-only --diff-filter=U').toString().trim().split('\n').filter(Boolean);
            for (const file of unmergedFiles) {
               execSync(`git checkout --theirs "${file}"`, { stdio: 'inherit' });
            }
            execSync('git add .', { stdio: 'inherit' });
            execSync(`git commit -m "Auto-resolve conflicts for PR #${number} favoring theirs"`, { stdio: 'inherit' });
        } catch (innerErr) {
            console.error(`Could not resolve conflicts. Skipping PR ${number}.`, innerErr.message);
            execSync('git merge --abort', { stdio: 'inherit' });
            continue;
        }
      }

      // We have merged successfully locally. Now push base to remote.
      console.log(`Pushing ${base} to origin...`);
      try {
          // Push local base back to origin base
          execSync(`git push origin ${base}`, { stdio: 'inherit' });
          console.log(`Successfully merged PR #${number} locally and pushed to origin/${base}`);
      } catch (e) {
          console.error(`Failed to push origin ${base} for PR #${number}:`, e.message);
      }
    }
  } catch (error) {
    console.error('Error in main:', error);
  }
}

main();
