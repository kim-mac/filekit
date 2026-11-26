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

test('static pages and same-origin assets support shared WASM memory', async ({ page, request }) => {
  for (const path of ['/', '/images/', '/about/licenses/']) {
    const response = await page.goto(path);
    expect(response?.headers()).toMatchObject({
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    expect(await page.evaluate(() => ({
      isolated: crossOriginIsolated,
      shared: typeof SharedArrayBuffer,
    }))).toEqual({ isolated: true, shared: 'function' });
  }
  const font = await request.get('/fonts/InterVariable.woff2');
  expect(font.headers()).toMatchObject({ 'cross-origin-resource-policy': 'same-origin' });
  expect(await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(face => face.family === 'Inter' && face.status === 'loaded');
  })).toBe(true);
});
