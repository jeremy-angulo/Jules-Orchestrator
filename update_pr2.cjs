const https = require('https');

const prNumber = process.argv[2];
if (!prNumber) {
    console.error("Please provide a PR number");
    process.exit(1);
}

const data = JSON.stringify({});

const options = {
    hostname: 'api.github.com',
    path: `/repos/jeremy-angulo/HomeFreeWorld/pulls/${prNumber}/update-branch`,
    method: 'PUT',
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
