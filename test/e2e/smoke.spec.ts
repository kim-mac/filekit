import { expect, test } from '@playwright/test';

test('the static export serves the FileKit home page', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'FileKit', level: 1 })).toBeVisible();
});
