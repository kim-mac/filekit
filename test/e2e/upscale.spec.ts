import { performance } from 'node:perf_hooks';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { downloadResult, fileRow, openImageWorkspace, pick, waitForFonts, waitForImage, toolTab } from './helpers';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const dimensions = (page: Page) => page.locator('.preview-footer > span');
const weights = /\/upscale-models\/chunks\//;

async function pickGenerated(page: Page, width: number, height: number) {
  const name = 'local-upscale-pattern.jpg';
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rgb[i] = (x + y) & 255;
      rgb[i + 1] = x & 255;
      rgb[i + 2] = y & 255;
    }
  }
  const buffer = await sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
  await page.getByLabel('Image files').setInputFiles({ name, mimeType: 'image/jpeg', buffer });
  await fileRow(page, name).getByRole('button', { name: /^local-upscale-pattern\.jpg/ }).click();
  await waitForImage(page, name);
}

test('upscales after a crop, replays history, and exports exact dimensions', async ({ page, context }, testInfo) => {
  const desktop = testInfo.project.name === 'desktop-chromium';
  const weightsRequests: string[] = [];
  context.on('request', req => { if (weights.test(req.url())) weightsRequests.push(req.url()); });
  await openImageWorkspace(page);
  await pick(page, 'oriented.png');
  await waitForImage(page, 'oriented.png');
  await toolTab(page, 'Crop').click();
  await page.getByRole('radio', { name: '4:5', exact: true }).check();
  await button(page, 'Rotate right').click();
  await button(page, 'Apply crop').click();
  await expect(dimensions(page)).toHaveText('80 × 64 px');
  await toolTab(page, 'Upscale').click();
  if (!desktop) await page.getByRole('radio', { name: 'Art/Text', exact: true }).check();
  if (desktop) await page.getByRole('radio', { name: '4×', exact: true }).check();
  const scale = desktop ? 4 : 2;
  const result = `${80 * scale} × ${64 * scale} px`;
  await expect(page.getByText(`Result ${result}`, { exact: true })).toBeVisible();
  await expect(page.getByText(desktop ? /4\.64 MiB model download/ : /2\.37 MiB model download/)).toBeVisible();
  expect(weightsRequests).toEqual([]);
  await button(page, 'Apply upscale').click();
  await expect(dimensions(page)).toHaveText(result, { timeout: 20_000 });
  await expect(page.getByText(desktop ? /Applied with Real-ESRGAN General · (WASM|WebGPU)/ : /Applied with Real-ESRGAN Anime · (WASM|WebGPU)/)).toBeVisible();
  expect(weightsRequests).toHaveLength(1);

  await button(page, 'Undo').click();
  await expect(dimensions(page)).toHaveText('80 × 64 px');
  await button(page, 'Redo').click();
  await expect(dimensions(page)).toHaveText(result);
  const { bytes } = await downloadResult(page, 'Export image');
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 80 * scale, height: 64 * scale, format: 'png' });
  expect(weightsRequests).toHaveLength(1);

  const tools = page.getByRole('region', { name: 'Tools' });
  await waitForFonts(page);
  await testInfo.attach('upscale-controls', { body: await tools.screenshot(), contentType: 'image/png' });
  if (['desktop-chromium', 'android-chromium'].includes(testInfo.project.name)) {
    await expect(tools).toHaveScreenshot('upscale-controls.png', { maxDiffPixelRatio: 0.04 });
  }
});

test('blocks over-limit output before requesting a model', async ({ page, context, isMobile }) => {
  const requests: string[] = [];
  context.on('request', req => { if (weights.test(req.url())) requests.push(req.url()); });
  await openImageWorkspace(page);
  const height = isMobile ? 1001 : 2001;
  const width = isMobile ? 1000 : 2000;
  await pickGenerated(page, width, height);
  await toolTab(page, 'Upscale').click();
  await page.getByRole('radio', { name: '4×', exact: true }).check();
  await expect(page.getByText(`Result ${(width * 4).toLocaleString('en-US')} × ${(height * 4).toLocaleString('en-US')} px`)).toBeVisible();
  await expect(page.getByText(isMobile ? /supports up to 16 MP/ : /supports up to 64 MP/)).toBeVisible();
  await expect(button(page, 'Apply upscale')).toBeDisabled();
  expect(requests).toEqual([]);
  await page.getByRole('radio', { name: '2×', exact: true }).check();
  await expect(button(page, 'Apply upscale')).toBeEnabled();
});

test('cancels tile inference and reuses verified chunks across workers', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Exercise the desktop Photo model');
  let downloads = 0;
  context.on('request', req => { if (weights.test(req.url())) downloads++; });
  await openImageWorkspace(page);
  await pick(page, 'oriented.png');
  await waitForImage(page, 'oriented.png');
  await toolTab(page, 'Upscale').click();
  await button(page, 'Apply upscale').click();
  await expect(dimensions(page)).toHaveText('128 × 192 px', { timeout: 20_000 });
  expect(downloads).toBe(1);

  await pickGenerated(page, 768, 768);
  await toolTab(page, 'Upscale').click();
  await button(page, 'Apply upscale').click();
  await expect(page.getByRole('status').filter({ hasText: /Tile \d+ of \d+/ })).toBeVisible();
  await button(page, 'Cancel edit').click();
  await expect(page.getByText('Edit canceled.')).toBeVisible();
  await expect(dimensions(page)).toHaveText('768 × 768 px');
  await expect(button(page, 'Undo')).toBeDisabled();

  await page.reload();
  await pick(page, 'oriented.png');
  await waitForImage(page, 'oriented.png');
  await toolTab(page, 'Upscale').click();
  await button(page, 'Apply upscale').click();
  await expect(dimensions(page)).toHaveText('128 × 192 px', { timeout: 20_000 });
  expect(downloads).toBe(1);
});

test('times the real Photo model at 1000×1000 to 4× on desktop Chromium', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' || process.env.FILEKIT_UPSCALE_TIMING !== '1',
    'Opt in to the 16 MP desktop timing run with FILEKIT_UPSCALE_TIMING=1');
  test.setTimeout(430_000);
  await openImageWorkspace(page);
  await pickGenerated(page, 1000, 1000);
  await toolTab(page, 'Upscale').click();
  await page.getByRole('radio', { name: '4×', exact: true }).check();
  const started = performance.now();
  await button(page, 'Apply upscale').click();
  await expect(page.getByRole('status').filter({ hasText: /Tile \d+ of \d+/ })).toBeVisible();
  await expect(dimensions(page)).toHaveText('4000 × 4000 px', { timeout: 400_000 });
  const applyMs = Math.round(performance.now() - started);
  const model = await page.getByText(/Applied with Real-ESRGAN General/).innerText();
  const timing = { input: '1000×1000', output: '4000×4000', model, applyMs };
  console.log('[upscale timing]', JSON.stringify(timing));
  await testInfo.attach('upscale-timing', { body: JSON.stringify(timing, null, 2), contentType: 'application/json' });
});
