import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = path.join(process.cwd(), 'tests', 'screenshots');
const ADMIN_EMAIL = process.env.SCREENSHOT_ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.SCREENSHOT_ADMIN_PASSWORD || 'AdminPassword123!';

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 302) {
        return;
      }
    } catch {
      // Retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

async function fillAndSubmitAuth(page) {
  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.fill('#mfaCode', '');
  await page.click('#submitBtn');
}

async function ensureDashboardAuthenticated(page) {
  await page.goto(`${BASE_URL}/login?setup=1`, { waitUntil: 'networkidle' });
  await fillAndSubmitAuth(page);

  try {
    await page.waitForURL('**/dashboard', { timeout: 7000 });
    await page.waitForLoadState('networkidle');
    return;
  } catch {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await fillAndSubmitAuth(page);
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await page.waitForLoadState('networkidle');
  }
}

async function assertRuntimeState(page) {
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/status');
    return res.json();
  });
  const keys = await page.evaluate(async () => {
    const res = await fetch('/api/keys');
    return res.json();
  });

  assert.equal(Boolean(status.mockMode), false, 'Mock mode must be disabled');
  assert.equal((status.runners || []).length, 0, 'No runner must auto-start on boot');
  assert.equal(Boolean(status.schedulers?.globalDailyMerge), false, 'Global scheduler must be suspended on boot');
  assert.equal(Boolean(status.schedulers?.autoMergeService), false, 'Auto-merge scheduler must be suspended on boot');
  assert.deepEqual(status.schedulers?.perProjectPipelines || [], [], 'Project schedulers must be suspended on boot');

  const limits = (keys.keys || []).map((entry) => Number(entry.limit24h));
  assert.ok(limits.length >= 1, 'At least one token must be visible for limit checks');
  assert.equal(limits[0], 100, 'Primary token limit must be 100');
  for (const limit of limits.slice(1)) {
    assert.equal(limit, 15, 'Secondary token limits must be 15');
  }

  const pageText = await page.textContent('body');
  assert.ok(!String(pageText || '').includes('NaN%'), 'UI must not display NaN%');
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const screenshotDbPath = path.join(SCREENSHOT_DIR, 'screenshot-test.db');
  const server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      ORCHESTRATOR_DB_PATH: screenshotDbPath,
      JULES_MAIN_TOKEN: 'test_main_token_1234567890',
      JULES_SECONDARY_TOKENS: 'test_secondary_a_1234567890,test_secondary_b_1234567890',
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || 'test_github_token_1234567890'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (chunk) => process.stdout.write(String(chunk)));
  server.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));

  let browser;
  try {
    await waitForServer(`${BASE_URL}/login`);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1510, height: 980 } });

    await ensureDashboardAuthenticated(page);
    await assertRuntimeState(page);

    const views = ['overview', 'projects', 'agents', 'sessions', 'health', 'users'];
    for (const view of views) {
      await page.click(`.nav-item[data-view="${view}"]`);
      await page.waitForSelector(`.view.is-active[data-view="${view}"]`, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${view}.png`),
        fullPage: true
      });
      console.log(`Screenshot captured: ${view}.png`);
    }

    console.log('All screenshots captured and runtime assertions passed.');
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
