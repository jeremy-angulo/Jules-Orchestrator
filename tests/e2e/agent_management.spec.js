import { test, expect } from '@playwright/test';

test.describe('Agent & Project Management End-to-End Flow', () => {
  test.beforeAll(async ({ request }) => {
    // Attempt to bootstrap admin user
    const response = await request.post('/auth/bootstrap-admin', {
      data: {
        email: 'sdet-admin@example.com',
        password: 'password123'
      }
    });
    expect([201, 409]).toContain(response.status());
  });

  test('successfully creates a new agent and a new project via UI modals', async ({ page }) => {
    // 1. Visit Login and log in
    await page.goto('/login');
    await page.fill('#email', 'sdet-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('#submitBtn');

    await page.waitForURL('**/dashboard**');
    await expect(page.locator('#currentUserLabel')).toHaveText('sdet-admin@example.com (admin)');

    // 2. Navigate to Agents view and create an agent
    await page.click('button.nav-item[data-view="agents"]');
    await expect(page.locator('#pageTitle')).toHaveText('Agent Library');

    await page.click('#createAgentBtn');
    await expect(page.locator('#agentModal')).toHaveClass(/show/);

    await page.fill('#agentModalName', 'E2E Agent Test');
    await page.fill('#agentModalDesc', 'Created by Playwright E2E');
    await page.fill('#agentModalPrompt', 'Instructions for E2E agent');

    await page.click('#agentModalSave');
    await expect(page.locator('#agentModal')).not.toHaveClass(/show/);
    await expect(page.locator('#agentsGrid')).toContainText('E2E Agent Test');

    // 3. Navigate to Projects view and create a project
    await page.click('button.nav-item[data-view="projects"]');
    await expect(page.locator('#pageTitle')).toHaveText('Projects');

    await page.click('#addProjectBtn');
    await expect(page.locator('#projectModal')).toHaveClass(/show/);

    await page.fill('#projectModalId', 'e2e-project-test');
    await page.fill('#projectModalRepo', 'owner/e2e-repo');

    await page.click('#projectModalSave');
    await expect(page.locator('#projectModal')).not.toHaveClass(/show/);
    await expect(page.locator('#projectsCards')).toContainText('e2e-project-test');
  });
});
