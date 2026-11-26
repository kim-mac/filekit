import { performance } from 'node:perf_hooks';
import { expect, test, type BrowserContext } from '@playwright/test';
import sharp from 'sharp';
import { downloadResult, openImageWorkspace, pick, savedLink, waitForImage, toolTab } from '../e2e/helpers';

async function configureWorkers(context: BrowserContext, single: boolean) {
  // Use the same build, assets and input in both runs. Restrict the control
  // run to one CPU and force the WASM path on both, even on GPU-equipped hosts.
  await context.route(/\/bench-worker\/(image|background)\.worker\.js$/, async route => {
    const script = new URL(route.request().url()).pathname.split('/').at(-1)!;
    await route.fulfill({
      contentType: 'text/javascript',
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
      body: `import '/workers/${script}';
Object.defineProperty(navigator, 'gpu', { value: undefined });
${single ? "Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1 });" : ''}`,
    });
  });
  await context.addInitScript(() => {
    localStorage.setItem('filekit-bg-lite-until', String(Date.now() + 60_000_000));
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const worker = new URL(url, location.href);
        if (/^\/workers\/(image|background)\.worker\.js$/.test(worker.pathname)) {
          worker.pathname = worker.pathname.replace('/workers/', '/bench-worker/');
        }
        super(worker, options);
      }
    };
  });
}

for (const single of [true, false]) {
  test(single ? 'single-thread control' : 'desktop threaded WASM', async ({ page, context }, testInfo) => {
    test.setTimeout(540_000);
    await configureWorkers(context, single);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await openImageWorkspace(page);
    const hardware = await page.evaluate(() => ({ cores: navigator.hardwareConcurrency, isolated: crossOriginIsolated }));
    expect(hardware.isolated).toBe(true);
    const threads = single ? 1 : Math.min(hardware.cores, 8);

    const width = 1000, height = 1000;
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 3;
        rgb[at] = (x + y) & 255;
        rgb[at + 1] = x & 255;
        rgb[at + 2] = y & 255;
      }
    }
    const buffer = await sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
    await page.getByLabel('Image files').setInputFiles({ name: 'benchmark.jpg', mimeType: 'image/jpeg', buffer });
    await waitForImage(page, 'benchmark.jpg');
    await toolTab(page, 'Upscale').click();
    await page.getByRole('radio', { name: '4×', exact: true }).check();
    const upscaleStart = performance.now();
    await button('Apply upscale').click();
    await expect(page.locator('.preview-dimensions')).toHaveText('4000 × 4000 px', { timeout: 420_000 });
    const upscaleMs = Math.round(performance.now() - upscaleStart);
    await expect(page.getByText('Applied with Real-ESRGAN General · WASM')).toBeVisible();
    const cachedStart = performance.now();
    const upscaled = await downloadResult(page, 'Export image');
    const cachedExportMs = Math.round(performance.now() - cachedStart);
    expect(await sharp(upscaled.bytes).metadata()).toMatchObject({ width: 4000, height: 4000, format: 'jpeg' });

    await openImageWorkspace(page);
    await pick(page, 'bg/portrait-wind.jpg');
    await waitForImage(page, 'portrait-wind.jpg');
    await toolTab(page, 'Remove background').click();
    const bgStart = performance.now();
    await button('Apply remove background').click();
    await expect(page.getByText('Quality mode Lite · WASM')).toBeVisible({ timeout: 120_000 });
    const backgroundMs = Math.round(performance.now() - bgStart);

    await openImageWorkspace(page);
    await pick(page, 'large-6000x4000.jpg');
    await waitForImage(page, 'large-6000x4000.jpg');
    const jpgStart = performance.now();
    await button('Export image').click();
    await expect(savedLink(page)).toBeVisible({ timeout: 25_000 });
    const jpgMs = Math.round(performance.now() - jpgStart);
    const [download] = await Promise.all([page.waitForEvent('download'), savedLink(page).click()]);
    expect(await sharp((await download.path())!).metadata()).toMatchObject({ width: 6000, height: 4000, format: 'jpeg' });

    const timings = { threads, logicalCores: hardware.cores, browser: page.context().browser()?.version(),
      upscaleMs, cachedExportMs, backgroundMs, jpgMs };
    console.log('[FileKit WASM benchmark]', JSON.stringify(timings));
    await testInfo.attach('wasm-benchmark.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  });
}
