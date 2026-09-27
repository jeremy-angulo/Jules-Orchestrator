import { test, expect } from '@playwright/test';

test.describe('Site Check Management End-to-End Flow', () => {
  test.beforeAll(async ({ request }) => {
    // Bootstrap admin user if not already set up
    const response = await request.post('/auth/bootstrap-admin', {
      data: {
        email: 'sdet-admin@example.com',
        password: 'password123'
      }
    });
    expect([201, 409]).toContain(response.status());
  });

  test('configures and toggles site check in project details view', async ({ page }) => {
    // 1. Visit Login and log in as admin
    await page.goto('/login');
    await page.fill('#email', 'sdet-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('#submitBtn');

    await page.waitForURL('**/dashboard**');
    await expect(page.locator('#currentUserLabel')).toHaveText('sdet-admin@example.com (admin)');

    // 2. Navigate to Projects view
    await page.click('button.nav-item[data-view="projects"]');
    await expect(page.locator('#pageTitle')).toHaveText('Projects');

    // Create a dedicated project for Site Check E2E testing
    await page.click('#addProjectBtn');
    await expect(page.locator('#projectModal')).toHaveClass(/show/);

    const projectId = `e2e-sitecheck-proj-${Date.now()}`;
    await page.fill('#projectModalId', projectId);
    await page.fill('#projectModalRepo', 'owner/sitecheck-repo');

    await page.click('#projectModalSave');
    await expect(page.locator('#projectModal')).not.toHaveClass(/show/);
    await expect(page.locator('#projectsCards')).toContainText(projectId);

    // 3. Open project detail view by clicking the project card
    const card = page.locator(`.project-card[data-project="${projectId}"]`);
    await card.click();

    // Verify view navigated to project detail
    await expect(page.locator('#view-project-detail')).toBeVisible();

    // 4. Click the Site Check tab
    await page.click('button.detail-tab-btn[data-tab="site-check"]');
    await expect(page.locator('h2:has-text("Site Check")')).toBeVisible();

    // 5. Verify Site Check configuration elements
    await expect(page.locator('#scToggleBtn')).toBeVisible();
    await expect(page.locator('#scLocale')).toBeVisible();
    await expect(page.locator('#scConcurrency')).toBeVisible();
    await expect(page.locator('#scPauseMs')).toBeVisible();

    // Fill configuration inputs
    await page.selectOption('#scLocale', 'en');
    await page.fill('#scConcurrency', '2');
    await page.fill('#scPauseMs', '3000');

    // 6. Toggle Site Check ON
    await page.click('#scToggleBtn');

    // Verify toggle state changed (button text should now say 'Disable' and status pill 'Running')
    await expect(page.locator('#scToggleBtn')).toHaveText('Disable');
    await expect(page.locator('.panel-head .status-pill')).toHaveText('Running');

    // 7. Toggle Site Check OFF
    await page.click('#scToggleBtn');
    await expect(page.locator('#scToggleBtn')).toHaveText('Enable');
    await expect(page.locator('.panel-head .status-pill')).toHaveText('Stopped');
  });
});
