import { test, expect } from '@playwright/test';

test.describe('Assignment Management End-to-End Flow', () => {
  const testProjectId = 'e2e-assignment-proj';
  const testAgentName = 'Assignment E2E Agent';

  test.beforeAll(async ({ request }) => {
    // 1. Bootstrap admin user
    const bootRes = await request.post('/auth/bootstrap-admin', {
      data: {
        email: 'sdet-admin@example.com',
        password: 'password123',
      },
    });
    expect([201, 409]).toContain(bootRes.status());

    // 2. Log in to get session cookie
    await request.post('/auth/login', {
      data: {
        email: 'sdet-admin@example.com',
        password: 'password123',
      },
    });

    // 3. Ensure test project exists via API
    await request.post('/api/projects/config', {
      data: {
        id: testProjectId,
        github_repo: 'owner/e2e-assignment-repo',
        github_branch: 'main',
      },
    });

    // 4. Ensure test agent exists via API
    await request.post('/api/agents', {
      data: {
        name: testAgentName,
        description: 'Agent created for assignment E2E test',
        prompt: 'You are an automated assignment test agent.',
        color: '#16d68f',
      },
    });
  });

  test('creates, manages, triggers, toggles, and deletes an assignment via UI', async ({ page }) => {
    // 1. Login via UI
    await page.goto('/login');
    await page.fill('#email', 'sdet-admin@example.com');
    await page.fill('#password', 'password123');
    await page.click('#submitBtn');

    await page.waitForURL('**/dashboard**');
    await expect(page.locator('#currentUserLabel')).toHaveText('sdet-admin@example.com (admin)');

    // 2. Navigate to project detail page
    await page.goto(`/dashboard?view=project-detail&project=${testProjectId}`);
    await expect(page.locator('#pageTitle')).toHaveText(testProjectId);

    // 3. Click "Agents" tab on project detail
    await page.click('.detail-tab-btn[data-tab="agents"]');

    // 4. Click "+ Add Assignment" button in Agents tab
    await page.click('button:has-text("+ Add Assignment")');
    await expect(page.locator('#assignmentModal')).toHaveClass(/show/);

    // 5. Select created agent from dropdown
    await page.selectOption('#assignmentModalAgent', { label: testAgentName });

    // 6. Submit assignment modal
    await page.click('#assignmentModalSave');
    await expect(page.locator('#assignmentModal')).not.toHaveClass(/show/);

    // 7. Verify assignment card is displayed in assignments grid
    const assignmentCard = page.locator('.assignment-card', { hasText: testAgentName });
    await expect(assignmentCard).toBeVisible();
    await expect(assignmentCard.locator('.chip.ok')).toHaveText('Enabled');

    // 8. Toggle assignment state (Disable)
    await assignmentCard.locator('button[data-action="assignment-toggle"]').click();
    await expect(assignmentCard.locator('.chip.muted-chip')).toHaveText('Disabled');

    // 9. Toggle assignment state back (Enable)
    await assignmentCard.locator('button[data-action="assignment-toggle"]').click();
    await expect(assignmentCard.locator('.chip.ok')).toHaveText('Enabled');

    // 10. Trigger assignment run ("Run Now")
    await assignmentCard.locator('button[data-action="assignment-run"]').click();
    await expect(page.locator('#toast')).toHaveClass(/show/);

    // 11. Delete assignment with dialog confirmation
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete this assignment?');
      await dialog.accept();
    });

    await assignmentCard.locator('button[data-action="assignment-delete"]').click();

    // 12. Verify assignment card is removed
    await expect(assignmentCard).not.toBeVisible();
  });
});
