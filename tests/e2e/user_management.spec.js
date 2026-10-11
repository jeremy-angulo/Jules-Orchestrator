import { test, expect } from '@playwright/test';

test.describe('User Management End-to-End Flow', () => {
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

  test('successfully creates, updates role of, and deletes a user via UI', async ({ page }) => {
    // 1. Visit Login and sign in as admin
    await page.goto('/login');
    await page.fill('#email', 'sdet-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('#submitBtn');

    await page.waitForURL('**/dashboard**');
    await page.waitForSelector('#currentUserLabel');

    // 2. Navigate to User Management view
    await page.click('button.nav-item[data-view="users"]');
    await expect(page.locator('#pageTitle')).toHaveText('User Management');

    // Unique email for this test run
    const newUserEmail = `test-user-${Date.now()}@example.com`;

    // Single dialog handler for all prompts and confirms in the user flow
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        const message = dialog.message();
        if (message.includes('Email:')) {
          await dialog.accept(newUserEmail);
        } else if (message.includes('Password:')) {
          await dialog.accept('userpass123');
        } else if (message.includes('Role')) {
          await dialog.accept('operator');
        } else if (message.includes('New role for')) {
          await dialog.accept('viewer');
        } else {
          await dialog.accept('viewer');
        }
      } else if (dialog.type() === 'confirm') {
        await dialog.accept();
      }
    });

    // 3. Click Invite User and fill prompts
    await page.click('#inviteUserBtn');

    // Verify toast notification for creation
    await expect(page.locator('#toast')).toContainText('User created');

    // Verify new user appears in user table
    const userRow = page.locator('#usersRows tr', { hasText: newUserEmail });
    await expect(userRow).toBeVisible();
    await expect(userRow.locator('.role-pill')).toHaveText('operator');

    // 4. Change user role to viewer
    await userRow.locator('button[data-action="change-role"]').click();
    await expect(page.locator('#toast')).toContainText('Role updated');
    await expect(userRow.locator('.role-pill')).toHaveText('viewer');

    // 5. Delete the created user
    await userRow.locator('button[data-action="delete-user"]').click();
    await expect(page.locator('#toast')).toContainText('User deleted');

    // Verify user is removed from table
    await expect(page.locator('#usersRows')).not.toContainText(newUserEmail);
  });
});
