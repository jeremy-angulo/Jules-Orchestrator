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

  // Note: We don't submit because we don't have a backend user seeded for this E2E test yet
  // and we want to avoid side effects or complex setup for a basic UI check.
});
