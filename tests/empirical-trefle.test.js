import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(process.cwd(), 'tests', 'empirical-trefle.db');
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'AdminPassword123!';

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
  // Wait for the JS to init the form (modeLabel is empty in HTML, JS fills it)
  await page.waitForFunction(() => {
    const label = document.querySelector('#modeLabel');
    return label && label.textContent.trim().length > 0;
  });
  
  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('#submitBtn');
}

async function ensureDashboardAuthenticated(page) {
  await page.goto(`${BASE_URL}/login?setup=1`, { waitUntil: 'networkidle' });
  await fillAndSubmitAuth(page);
  await page.waitForURL('**/dashboard', { timeout: 7000 });
  await page.waitForLoadState('networkidle');
}

async function main() {
  console.log('Starting empirical testing on Trefle-AI...');
  
  // Clean up any old test db
  try { await fs.unlink(DB_PATH); } catch (e) {}
  try { await fs.unlink(DB_PATH + '-wal'); } catch (e) {}
  try { await fs.unlink(DB_PATH + '-shm'); } catch (e) {}

  const bootstrapData = await fs.readFile(path.join(process.cwd(), 'bootstrap.json'), 'utf-8');

  const server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      TURSO_DATABASE_URL: 'file:' + DB_PATH,
      BOOTSTRAP_DATA: bootstrapData,
      JULES_MAIN_TOKEN: 'test_main_token_1234567890',
      JULES_SECONDARY_TOKENS: 'test_secondary_a_1234567890',
      GITHUB_TOKEN: 'test_github_token_1234567890'
    }
  });

  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
  server.stderr.on('data', (chunk) => { serverOutput += String(chunk); });

  let browser;
  try {
    await waitForServer(`${BASE_URL}/login`);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Listen for JS errors
    const errors = [];
    page.on('pageerror', error => {
        errors.push(`JS Error: ${error.message}`);
    });
    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(`Console Error: ${msg.text()}`);
        } else {
            console.log(`[Browser]: ${msg.text()}`);
        }
    });

    await ensureDashboardAuthenticated(page);
    
    // Navigate to Projects view
    console.log('Navigating to Projects...');
    await page.click('.nav-item[data-view="projects"]');
    await page.waitForSelector('.project-card', { timeout: 10000 });
    
    // Open Trefle-AI project
    console.log('Opening Trefle-AI project...');
    const trefleCard = page.locator('.project-card', { hasText: 'Trefle-ai-IHM' });
    await trefleCard.click();
    await page.waitForSelector('#pageTitle', { timeout: 10000 });
    
    const projectName = await page.textContent('#pageTitle');
    assert.ok(projectName.includes('Trefle-ai-IHM'), 'Should be on Trefle-AI project detail');

    // Switch to Agents tab
    console.log('Switching to Agents tab...');
    await page.locator('.detail-tab-btn', { hasText: 'Agents' }).click();
    
    // Create an assignment first so we have buttons to click
    console.log('Creating a test assignment...');
    await page.waitForSelector('button:has-text("+ Add Assignment")', { state: 'visible', timeout: 10000 });
    await page.locator('button', { hasText: '+ Add Assignment' }).click();
    await page.waitForSelector('#assignmentModal', { state: 'visible' });
    // Fill the modal
    const firstAgentValue = await page.$eval('#assignmentModalAgent option:nth-child(2)', el => el.value);
    await page.selectOption('#assignmentModalAgent', firstAgentValue);
    await page.click('#assignmentModalSave');
    await page.waitForSelector('#assignmentModal', { state: 'hidden' });
    await page.waitForSelector('.assignment-card', { timeout: 10000 });

    // Find all buttons in the project detail view
    const buttons = await page.locator('#view-project-detail [data-action]').all();
    console.log(`Found ${buttons.length} buttons with data-action. Clicking them...`);
    
    for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const action = await btn.getAttribute('data-action');
        console.log(`- Testing button: ${action}`);
        
        // Skip run-pipeline because it takes a long time and hits GitHub
        if (action === 'run-pipeline') {
             console.log('  (Skipping run-pipeline to avoid long network tasks)');
             continue;
        }

        // Some buttons open modals, we need to close them after
        if (action === 'assignment-edit') {
            await btn.click();
            await page.waitForSelector('#assignmentModal', { state: 'visible' });
            await page.click('#assignmentModal .modal-close');
            await page.waitForSelector('#assignmentModal', { state: 'hidden' });
            continue;
        }
        
        if (action === 'run-agent-once') {
            await btn.click();
            await page.waitForSelector('#runAgentModal', { state: 'visible' });
            await page.click('#runAgentModal .modal-close');
            await page.waitForSelector('#runAgentModal', { state: 'hidden' });
            continue;
        }

        if (action === 'view-session') {
            await btn.click();
            try {
                await page.waitForSelector('#sessionDrawer', { state: 'visible', timeout: 5000 });
                await page.click('#sessionDrawerClose');
                await page.waitForSelector('#sessionDrawer', { state: 'hidden' });
            } catch (e) {
                console.log('  (Session drawer did not open, maybe disabled)');
            }
            continue;
        }
        
        // For destructive actions, we handle the confirm dialog
        if (action === 'assignment-delete') {
            page.once('dialog', dialog => dialog.accept());
            await btn.click();
            // Wait a bit for the UI to update
            await page.waitForTimeout(1000);
            continue;
        }
        
        // For all other normal actions (toggle lock, assignment-stop, etc.)
        await btn.click();
        await page.waitForTimeout(1000); // Give it a moment to trigger errors if any
    }

    if (errors.length > 0) {
        console.error('🚨 Errors detected during UI testing:');
        errors.forEach(e => console.error(e));
        process.exit(1);
    } else {
        console.log('✅ All buttons clicked empirically. No JavaScript errors detected!');
    }

  } catch (error) {
    if (browser && browser.contexts().length > 0) {
      const page = browser.contexts()[0].pages()[0];
      if (page) {
        console.error('--- PROJECT DETAIL HTML ON FAILURE ---');
        try {
            console.error(await page.innerHTML('#projectDetailContent'));
        } catch(e) {
            console.error('Could not get projectDetailContent', e);
        }
        try {
            console.error('--- TOAST ---');
            console.error(await page.textContent('#toast'));
            console.error('-------------');
        } catch(e) {}
        console.error('--------------------------------------');
      }
    }
    console.error('Test script failed:', error);
    console.error('--- FULL SERVER OUTPUT ---');
    console.error(serverOutput);
    console.error('--------------------------');
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill('SIGTERM');
  }
}

main();