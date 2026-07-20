import { test, expect } from '@playwright/test';

test.describe('Dashboard End-to-End Flow', () => {
  test.beforeAll(async ({ request }) => {
    // Attempt to bootstrap admin user
    const response = await request.post('/auth/bootstrap-admin', {
      data: {
        email: 'sdet-admin@example.com',
        password: 'password123'
      }
    });

    // We expect 201 (Created) or 409 (Conflict - Setup already completed)
    expect([201, 409]).toContain(response.status());
  });

  test('successfully logs in, navigates through all views, and logs out', async ({ page }) => {
    // 1. Visit Login
    await page.goto('/login');
    await expect(page).toHaveTitle(/Login/);

    // 2. Fill login form
    await page.fill('#email', 'sdet-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('#submitBtn');

    // 3. Verify redirected to dashboard and authenticated
    await page.waitForURL('**/dashboard**');
    await expect(page).toHaveTitle('Jules Orchestrator');

    // Wait for initial dashboard fetch/rendering
    await page.waitForSelector('#currentUserLabel');
    await expect(page.locator('#currentUserLabel')).toHaveText('sdet-admin@example.com (admin)');

    // Take screenshot of the main dashboard (Overview view)
    await page.screenshot({ path: 'tests/e2e/dashboard_overview.png' });

    // 4. Test View navigation
    // Clicking "Projects"
    await page.click('button.nav-item[data-view="projects"]');
    await expect(page.locator('#pageTitle')).toHaveText('Projects');
    await expect(page.locator('h2:has-text("Connected Projects")')).toBeVisible();

    // Clicking "Agents"
    await page.click('button.nav-item[data-view="agents"]');
    await expect(page.locator('#pageTitle')).toHaveText('Agent Library');
    await expect(page.locator('h2:has-text("Active Runners")')).toBeVisible();

    // Clicking "Sessions"
    await page.click('button.nav-item[data-view="sessions"]');
    await expect(page.locator('#pageTitle')).toHaveText('Session Monitor');
    await expect(page.locator('h2:has-text("Session Monitor")')).toBeVisible();

    // Clicking "Health"
    await page.click('button.nav-item[data-view="health"]');
    await expect(page.locator('#pageTitle')).toHaveText('System Health');
    await expect(page.locator('h2:has-text("API Token Usage")')).toBeVisible();

    // Clicking "Users"
    await page.click('button.nav-item[data-view="users"]');
    await expect(page.locator('#pageTitle')).toHaveText('User Management');
    await expect(page.locator('h2:has-text("User Management")')).toBeVisible();
    // Verify our user is in the users list
    await expect(page.locator('#usersRows')).toContainText('sdet-admin@example.com');

    // 5. Click "Logout"
    await page.click('#logoutBtn');

    // 6. Verify back to login page
    await page.waitForURL('**/login');
    await expect(page.locator('h1')).toHaveText('Connexion dashboard');
  });
});
