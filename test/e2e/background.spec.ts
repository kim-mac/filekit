import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { countDownloadNotices, downloadResult, fixtureBytes, observeModelCalls, openImageWorkspace, pick, waitForFonts, waitForImage, toolTab, selectFormat } from './helpers';

test.use({ serviceWorkers: 'block' });

test('offers and remembers a background model choice', async ({ page }, { project }) => {
  test.skip(project.name !== 'desktop-chromium');
  await page.addInitScript(() => localStorage.setItem('filekit-bg-lite-until', String(Date.now() + 60_000)));
  const select = page.getByRole('combobox', { name: 'Model', exact: true });
  const openModel = async () => {
    await openImageWorkspace(page);
    await pick(page, 'transparent.png');
    await waitForImage(page, 'transparent.png');
    await toolTab(page, 'Remove background').click();
  };
  await openModel();
  await expect(select).toHaveValue('auto');
  await expect(select.locator('option')).toHaveText([
    'Auto (recommended)', 'Best quality — slower, ~451 MB one-time download', 'Fast — quicker, ~94 MB',
  ]);
  await select.selectOption('full');
  await expect(page.getByText('Your device may be slow or run out of memory with Best quality. FileKit will switch to Fast automatically if it fails.')).toBeVisible();
  await openModel();
  await expect(select).toHaveValue('full');
  await select.selectOption('lite');
  await openModel();
  await expect(select).toHaveValue('lite');
});

test('Lite removal cancels, retries, caches weights, and replays background, crop, and conversion', async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' || process.env.FILEKIT_BG_E2E !== '1',
    'Real Lite model is staged for Chromium with FILEKIT_BG_E2E=1');
  test.setTimeout(300_000);
  const calls = await observeModelCalls(page, 'makeMask');
  const noticeCount = await countDownloadNotices(page);
  await page.addInitScript(() => {
    const steps = new Set<string>();
    new MutationObserver(() => {
      const text = document.querySelector('.tool-feedback .progress-meta [role="status"]')?.textContent;
      if (text) {
        steps.add(text);
        document.documentElement.dataset.backgroundSteps = JSON.stringify([...steps]);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const origin = new URL(baseURL!).origin;
  const violations: string[] = [];
  const modelPath = 'public/bg-model-source/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model_fp16.onnx.json';
  const { sha256 } = JSON.parse(await readFile(modelPath, 'utf8'));
  let chunks = 0;
  let cancelDownload = true;
  let allowChunk!: () => void;
  const chunkHeld = new Promise<void>(resolve => { allowChunk = resolve; });
  let holdSecondChunk = false;
  let allowSecondChunk!: () => void;
  const secondChunkHeld = new Promise<void>(resolve => { allowSecondChunk = resolve; });
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
      if (holdSecondChunk && url.pathname.endsWith('/1.bin')) await secondChunkHeld;
    }
    return route.continue();
  });

  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await openImageWorkspace(page);
  await pick(page, 'bg/portrait-wind.jpg');
  await waitForImage(page, 'portrait-wind.jpg');
  await toolTab(page, 'Remove background').click();
  await button('Apply remove background').click();
  try {
    await expect.poll(() => chunks, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByText(/One-time model download \(~94 MB\)/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Model download progress' })).toBeVisible();
    await button('Cancel edit').click();
    await expect(page.getByText('Edit canceled.')).toBeVisible();
    await expect(button('Undo')).toBeDisabled();
  } finally {
    cancelDownload = false;
    allowChunk();
  }

  holdSecondChunk = true;
  await button('Apply remove background').click();
  const tools = page.getByRole('region', { name: 'Tools' });
  const bar = tools.getByRole('progressbar', { name: 'Model download progress' });
  try {
    await expect(bar).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/, { timeout: 30_000 });
    await expect(tools.getByText(/Downloading model… .* \/ 94 MB/)).toBeVisible();
    await expect(tools.getByText(/About .* remaining/)).toBeVisible();
  } finally {
    holdSecondChunk = false;
    allowSecondChunk();
  }
  await expect(tools.getByText(/Model used: Fast/)).toBeVisible({ timeout: 180_000 });
  const labels = JSON.parse(await page.locator('html').getAttribute('data-background-steps') ?? '[]');
  expect(labels).toEqual(expect.arrayContaining([
    'Step 1 of 3: Preparing image', 'Step 2 of 3: Finding the subject', 'Step 3 of 3: Refining edges',
  ]));
  await expect(button('Undo')).toBeEnabled();
  await toolTab(page, 'Convert').click();
  await selectFormat(page, 'PNG');
  await button('Apply convert').click();
  expect(await calls()).toBe(2);
  const transparent = await downloadResult(page, 'Export image');
  expect(await calls()).toBe(2);
  const photo = sharp(transparent.bytes);
  const metadata = await photo.metadata();
  expect(metadata).toMatchObject({ format: 'png', hasAlpha: true });
  expect((await photo.stats()).channels[3]).toMatchObject({ min: 0, max: 255 });

  const firstDownloadCount = chunks;
  await toolTab(page, 'Remove background').click();
  await page.getByRole('radio', { name: 'Color', exact: true }).check();
  await page.getByLabel('Background color').fill('#104e32');
  await button('Apply remove background').click();
  const colored = await downloadResult(page, 'Export image');
  expect(await calls()).toBe(2);
  const pixel = await sharp(colored.bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  expect([...pixel].slice(0, 3)).toEqual([16, 78, 50]);
  expect(chunks).toBe(firstDownloadCount);
  await waitForFonts(page);
  await testInfo.attach('background-solid', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await button('Undo').click();
  await expect(page.getByRole('radio', { name: 'Transparent', exact: true })).toBeChecked();
  await expect(button('Redo')).toBeEnabled();
  await button('Redo').click();
  await expect(page.getByRole('radio', { name: 'Color', exact: true })).toBeChecked();

  await toolTab(page, 'Crop').click();
  await page.getByRole('radio', { name: '1:1', exact: true }).check();
  await button('Apply crop').click();
  const cropped = await downloadResult(page, 'Export image');
  const square = await sharp(cropped.bytes).metadata();
  expect(square.width).toBe(square.height);
  expect(square.width).toBeLessThanOrEqual(Math.min(metadata.width!, metadata.height!));
  // Start a new workspace and worker while preserving the browser's Cache Storage.
  await openImageWorkspace(page);
  await page.getByLabel('Image files').setInputFiles({
    name: 'private-bg-fixture.jpg', mimeType: 'image/jpeg', buffer: await fixtureBytes('bg/portrait-wind.jpg'),
  });
  await waitForImage(page, 'private-bg-fixture.jpg');
  await toolTab(page, 'Remove background').click();
  await button('Apply remove background').click();
  await expect(tools.getByText(/Model used: Fast/)).toBeVisible({ timeout: 90_000 });
  expect(chunks).toBe(firstDownloadCount);
  expect(await noticeCount()).toBe(0);
  expect(violations).toEqual([]);
});

test('iPhone WebKit uses the quantized Lite worker and shows its output cap', async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-webkit' || process.env.FILEKIT_BG_E2E !== '1',
    'Quantized Lite is staged for iPhone WebKit with FILEKIT_BG_E2E=1');
  test.setTimeout(180_000);

  const origin = new URL(baseURL!).origin;
  const requests = new Set<string>();
  const violations: string[] = [];
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET' || request.postDataBuffer() ||
      request.url().includes('portrait-wind')) {
      violations.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    requests.add(url.pathname);
    return route.continue();
  });
  await openImageWorkspace(page);
  await pick(page, 'bg/portrait-wind.jpg');
  await waitForImage(page, 'portrait-wind.jpg');
  await toolTab(page, 'Remove background').tap();
  await expect(page.getByText('Using Lite quality on this device. For best results, use a laptop or desktop.')).toBeVisible();
  const select = page.getByRole('combobox', { name: 'Model', exact: true });
  await select.selectOption('full');
  await expect(page.getByText(/Your device may be slow or run out of memory/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply remove background' }).tap();
  await expect(page.getByText('Model used: Fast (quantized BiRefNet Lite) · WASM')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/FileKit switched to Fast/)).toBeVisible();
  await expect(select).toHaveValue('full');
  await expect(page.getByText('The longest side of the exported image is limited to 1,280 px on this device.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Export' }).getByLabel('Fill transparent areas with')).toHaveValue('#ffffff');
  await toolTab(page, 'Convert').tap();
  await selectFormat(page, 'PNG');
  await page.getByRole('button', { name: 'Apply convert' }).tap();
  const result = await downloadResult(page, 'Export image');
  expect(await sharp(result.bytes).metadata()).toMatchObject({ format: 'png', hasAlpha: true });
  expect(requests).toContain('/bg-runtime/ios/int8-full-512.ort.json');
  expect(violations).toEqual([]);
});
