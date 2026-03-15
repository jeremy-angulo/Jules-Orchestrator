const { execSync } = require('child_process');
const https = require('https');

const commitSha = execSync(`cd HomeFreeWorld && git rev-parse HEAD`).toString().trim();

const data = JSON.stringify({
    sha: commitSha,
    force: true
});

const options = {
    hostname: 'api.github.com',
    // The ref needs to be just the part after refs/, e.g., heads/feature/...
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
