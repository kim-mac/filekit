import { expect, test } from '@playwright/test';

test('the static export serves the FileKit home page', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'FileKit', level: 1 })).toBeVisible();
});

test('the static export omits the background model benchmark', async ({ page }) => {
  const response = await page.goto('/dev/bg-bench');

  expect(response?.status()).toBe(404);
});


test('the static export serves the background model license notices', async ({ page }) => {
  await page.goto('/about/licenses');
  await expect(page.getByRole('heading', { name: 'Licenses' })).toBeVisible();
  const href = await page.getByRole('link', { name: /BiRefNet Full/ }).getAttribute('href');
  const license = await page.request.get(href!);
  expect(license.ok()).toBe(true);
  expect(await license.text()).toContain('Permission is hereby granted');
});
