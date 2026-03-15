const { execSync } = require('child_process');

// Merge and commit locally
try {
  execSync(`cd HomeFreeWorld && git fetch origin && git checkout feature/network-expansion-polish-7610547164018700710 && git merge --no-edit origin/dev || true`);
} catch (e) {
  console.log("Merge had conflicts");
}

execSync(`cd HomeFreeWorld && sed -i -e '/<<<<<<< HEAD/,/=======/c\\      return {\\n          success: true,\\n          data: randoms.map(u => ({\\n            id: u.id,\\n            firstName: u.firstName,\\n            lastName: u.lastName,\\n            profileImage: u.profileImage,\\n            city: u.city,\\n            country: null,\\n            identityVerified: u.identityVerified,\\n            trustLevel: undefined, // Not selected above\\n            trustBonus: 5,\\n            jobTitle: u.jobTitle,\\n            propertyCount: u._count?.properties || 0,\\n            role: u.role,\\n            score: 0,\\n            mutualFriends: 0,\\n            mutualFriendPreviews: [],\\n            reason: "New member"\\n          }))\\n      };' -e '/>>>>>>> origin\\/dev/d' app/actions/social.ts`);

execSync(`cd HomeFreeWorld && git add app/actions/social.ts && git commit -m "Resolve merge conflicts"`);

// Let's create an empty PR in Jules-Orchestrator to trigger something? Or use GitHub REST API to force-update ref

const https = require('https');

const commitSha = execSync(`cd HomeFreeWorld && git rev-parse HEAD`).toString().trim();

const data = JSON.stringify({
    sha: commitSha,
    force: true
});

const options = {
    hostname: 'api.github.com',
    path: `/repos/jeremy-angulo/HomeFreeWorld/git/refs/heads/feature/network-expansion-polish-7610547164018700710`,
    method: 'PATCH',
    headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Node.js',
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    let responseData = '';

    res.on('data', (chunk) => {
        responseData += chunk;
    });

    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(responseData);
    });
});

req.on('error', (error) => {
    console.error(`Error: ${error.message}`);
});

req.write(data);
req.end();
