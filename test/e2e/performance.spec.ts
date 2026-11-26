import { readFile } from 'node:fs/promises';
import { performance as timer } from 'node:perf_hooks';
import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { openImageWorkspace, pick, savedLink, toolTab, setSlider } from './helpers';

async function observePreview(page: Page, trigger: 'change' | 'click') {
  await page.evaluate((trigger) => {
    const stage = document.querySelector<HTMLElement>('.preview-stage')!;
    const previous = stage.querySelector<HTMLImageElement>('.preview-image')?.src;
    document.addEventListener(trigger, () => {
      const start = performance.now();
      delete stage.dataset.previewMs;
      const observer = new MutationObserver(() => {
        const image = stage.querySelector<HTMLImageElement>('.preview-image');
        if (!image || image.src === previous) return;
        observer.disconnect();
        image.decode().then(() => {
          stage.dataset.previewMs = String(Math.round(performance.now() - start));
        });
      });
      observer.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }, { capture: true, once: true });
  }, trigger);
}

async function previewTiming(page: Page) {
  const stage = page.locator('.preview-stage');
  await expect(stage).toHaveAttribute('data-preview-ms', /^\d+$/, { timeout: 20_000 });
  return Number(await stage.getAttribute('data-preview-ms'));
}

async function rendererPeakKiB(browser: Browser, browserName: string) {
  if (browserName !== 'chromium' || process.platform !== 'linux') return undefined;
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const peaks = await Promise.all(processInfo.filter(({ type }) => type === 'renderer').map(async ({ id }) => {
      const status = await readFile(`/proc/${id}/status`, 'utf8').catch(() => '');
      return Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    }));
    return Math.max(0, ...peaks) || undefined;
  } finally {
    await session.detach();
  }
}

test('times first and subsequent previews and full-resolution export for a 6000×4000 image', async ({ page, browser, browserName }, testInfo) => {
  test.setTimeout(55_000);
  const fixture = 'large-6000x4000.jpg';
  await openImageWorkspace(page);
  const idlePeakKiB = await rendererPeakKiB(browser, browserName);
  await observePreview(page, 'change');
  await pick(page, fixture);
  const firstPreviewMs = await previewTiming(page);
  const preview = page.getByRole('img', { name: `Preview of ${fixture}` });
  const previewDimensions = await preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]);
  expect(previewDimensions).toEqual([2048, 1365]);
  await expect(page.getByText('6000 × 4000 px')).toBeVisible();

  const subsequentPreviewMs = [];
  for (const quality of [80, 75, 70]) {
    await setSlider(page.getByRole('slider', { name: 'Quality' }), quality);
    await observePreview(page, 'click');
    await page.getByRole('button', { name: 'Apply convert' }).click();
    subsequentPreviewMs.push(await previewTiming(page));
    await expect(page.getByText(`JPG (JPEG) · Quality ${quality}%`)).toBeVisible();
  }

  const exportStart = timer.now();
  await page.getByRole('button', { name: 'Export image' }).click();
  const uiFrameMs = await page.evaluate(() => {
    const start = performance.now();
    return new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now() - start)));
  });
  await expect(savedLink(page)).toBeVisible({ timeout: 25_000 });
  const exportMs = Math.round(timer.now() - exportStart);
  const [download] = await Promise.all([page.waitForEvent('download'), savedLink(page).click()]);
  const metadata = await sharp((await download.path())!).metadata();
  expect(metadata).toMatchObject({ width: 6000, height: 4000, format: 'jpeg' });
  expect(metadata.exif).toBeUndefined();
  const unrotatedPeakKiB = await rendererPeakKiB(browser, browserName);

  await toolTab(page, 'Crop').click();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await observePreview(page, 'click');
  await page.getByRole('button', { name: 'Apply crop' }).click();
  const rotatedPreviewMs = await previewTiming(page);
  await expect(page.locator('.preview-dimensions')).toHaveText('4000 × 6000 px');

  let rotatedPeakKiB: number | undefined;
  let rotatedExportMs: number | undefined;
  if (testInfo.project.name === 'desktop-chromium') {
    const start = timer.now();
    await page.getByRole('button', { name: 'Export image' }).click();
    await expect(savedLink(page)).toBeVisible({ timeout: 25_000 });
    rotatedExportMs = Math.round(timer.now() - start);
    const [rotated] = await Promise.all([page.waitForEvent('download'), savedLink(page).click()]);
    const rotatedMetadata = await sharp((await rotated.path())!).metadata();
    expect(rotatedMetadata).toMatchObject({ width: 4000, height: 6000 });
    expect(rotatedMetadata.exif).toBeUndefined();
    rotatedPeakKiB = await rendererPeakKiB(browser, browserName);
  }
  const timings = {
    project: testInfo.project.name, format: 'JPG', quality: 70, firstPreviewMs, subsequentPreviewMs,
    rotatedPreviewMs, exportMs, rotatedExportMs, uiFrameMs: Math.round(uiFrameMs),
  };
  const sourceRgbaBytes = metadata.width! * metadata.height! * 4;
  const previewRgbaBytes = previewDimensions[0] * previewDimensions[1] * 4;
  const transposeScratchBytes = Math.ceil(sourceRgbaBytes / 32);
  const memory = {
    project: testInfo.project.name, sourceRgbaBytes, previewRgbaBytes, transposeScratchBytes,
    idlePeakKiB, unrotatedPeakKiB, rotatedPeakKiB,
  };
  console.log(`FileKit timing ${JSON.stringify(timings)}`);
  console.log(`FileKit memory ${JSON.stringify(memory)}`);
  await testInfo.attach('timings', { body: JSON.stringify(timings), contentType: 'application/json' });
  await testInfo.attach('memory', { body: JSON.stringify(memory), contentType: 'application/json' });
  expect(uiFrameMs).toBeLessThan(1_500);
  expect(firstPreviewMs).toBeLessThan(20_000);
  expect(exportMs).toBeLessThan(25_000);
  if (testInfo.project.name === 'desktop-chromium') {
    expect(Math.max(...subsequentPreviewMs, rotatedPreviewMs)).toBeLessThan(300);
  }
});
