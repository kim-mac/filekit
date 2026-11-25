import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { downloadResult, fixtureBytes, openImageWorkspace, pick, waitForImage } from './helpers';

test.use({ serviceWorkers: 'block' });

test('Lite removal cancels, retries, caches weights, and replays background, crop, and conversion', async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' || process.env.FILEKIT_BG_E2E !== '1',
    'Real Lite model is staged for Chromium with FILEKIT_BG_E2E=1');
  test.setTimeout(300_000);
  const origin = new URL(baseURL!).origin;
  const violations: string[] = [];
  const modelPath = 'public/bg-model-source/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model_fp16.onnx.json';
  const { sha256 } = JSON.parse(await readFile(modelPath, 'utf8'));
  let chunks = 0;
  let cancelDownload = true;
  let allowChunk!: () => void;
  const chunkHeld = new Promise<void>(resolve => { allowChunk = resolve; });
  await context.addInitScript(() => localStorage.setItem('filekit-bg-lite-until', String(Date.now() + 60_000_000)));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET' || request.postDataBuffer() ||
      /portrait-wind|private-bg-fixture/i.test(request.url())) {
      violations.push(`${request.method()} ${request.url()} body=${request.postDataBuffer()?.length ?? 0} type=${request.resourceType()}`);
      return route.abort();
    }
    if (url.pathname.startsWith(`/bg-models/chunks/${sha256}/`)) {
      chunks++;
      if (cancelDownload) {
        await chunkHeld;
        return route.abort().catch(() => undefined);
      }
    }
    return route.continue();
  });

  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await openImageWorkspace(page);
  await pick(page, 'bg/portrait-wind.jpg');
  await waitForImage(page, 'portrait-wind.jpg');
  await button('Remove background').click();
  await button('Apply remove background').click();
  try {
    await expect.poll(() => chunks, { timeout: 30_000 }).toBeGreaterThan(0);
    await button('Cancel edit').click();
    await expect(page.getByText('Edit canceled.')).toBeVisible();
    await expect(button('Undo')).toBeDisabled();
  } finally {
    cancelDownload = false;
    allowChunk();
  }

  await button('Apply remove background').click();
  const tools = page.getByRole('region', { name: 'Tools' });
  await expect(tools.getByText(/Quality mode Lite/)).toBeVisible({ timeout: 180_000 });
  await expect(button('Undo')).toBeEnabled();
  await button('Convert').click();
  await page.getByRole('radio', { name: 'PNG', exact: true }).check();
  await button('Apply convert').click();
  const transparent = await downloadResult(page, 'Export image');
  const photo = sharp(transparent.bytes);
  const metadata = await photo.metadata();
  expect(metadata).toMatchObject({ format: 'png', hasAlpha: true });
  expect((await photo.stats()).channels[3]).toMatchObject({ min: 0, max: 255 });

  const firstDownloadCount = chunks;
  await button('Remove background').click();
  await page.getByRole('radio', { name: 'Solid color', exact: true }).check();
  await page.getByLabel('Background color').fill('#104e32');
  await button('Apply remove background').click();
  const colored = await downloadResult(page, 'Export image');
  const pixel = await sharp(colored.bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  expect([...pixel].slice(0, 3)).toEqual([16, 78, 50]);
  expect(chunks).toBe(firstDownloadCount);
  await testInfo.attach('background-solid', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await button('Undo').click();
  await expect(page.getByRole('radio', { name: 'Transparent', exact: true })).toBeChecked();
  await expect(button('Redo')).toBeEnabled();
  await button('Redo').click();
  await expect(page.getByRole('radio', { name: 'Solid color', exact: true })).toBeChecked();

  await button('Crop').click();
  await page.getByRole('radio', { name: '1:1', exact: true }).check();
  await button('Apply crop').click();
  const cropped = await downloadResult(page, 'Export image');
  const square = await sharp(cropped.bytes).metadata();
  expect(square.width).toBe(square.height);
  expect(square.width).toBeLessThanOrEqual(Math.min(metadata.width!, metadata.height!));
  await page.getByLabel('Image files').setInputFiles({
    name: 'private-bg-fixture.jpg', mimeType: 'image/jpeg', buffer: await fixtureBytes('bg/portrait-wind.jpg'),
  });
  await page.getByRole('button', { name: /^private-bg-fixture\.jpg/ }).click();
  await waitForImage(page, 'private-bg-fixture.jpg');
  await button('Remove background').click();
  await button('Apply remove background').click();
  await expect(tools.getByText(/Quality mode Lite/)).toBeVisible({ timeout: 90_000 });
  expect(chunks).toBe(firstDownloadCount);
  expect(violations).toEqual([]);
});
