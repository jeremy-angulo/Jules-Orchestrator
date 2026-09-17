import { test, expect } from '@playwright/test';

test('Login page has French UI elements and can be filled', async ({ page }) => {
  await page.goto('/login');

  // Verify French UI elements
  await expect(page.locator('h1')).toHaveText('Connexion dashboard');
  await expect(page.locator('#modeLabel')).toHaveText('Connecte-toi avec ton compte.');
  await expect(page.locator('label:has-text("Email")')).toBeVisible();
  await expect(page.locator('label:has-text("Mot de passe")')).toBeVisible();
  await expect(page.locator('#submitBtn')).toHaveText('Se connecter');

  // Fill the form
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'password123');

  // Verify values are filled
  expect(await page.inputValue('#email')).toBe('test@example.com');
  expect(await page.inputValue('#password')).toBe('password123');
});

test('Login page shows error feedback on invalid credentials when setup is complete', async ({ page, request }) => {
  // Bootstrap admin first to ensure setup is completed
  await request.post('/auth/bootstrap-admin', {
    data: { email: 'admin@example.com', password: 'AdminPassword123!' }
  });

  await page.goto('/login');

  await page.fill('#email', 'wrong@example.com');
  await page.fill('#password', 'wrongpassword');
  await page.click('#submitBtn');

  await expect(page.locator('#feedback')).toBeVisible();
  await expect(page.locator('#feedback')).not.toBeEmpty();
});
