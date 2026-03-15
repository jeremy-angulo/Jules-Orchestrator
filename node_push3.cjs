const { execSync } = require('child_process');
try {
  console.log(execSync('cd HomeFreeWorld && git diff origin/feature/network-expansion-polish-7610547164018700710').toString());
} catch (e) {
  console.error(e.message);
}
