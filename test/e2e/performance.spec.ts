import { performance as timer } from 'node:perf_hooks';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { applyConversion, openImageWorkspace, pick, savedLink, waitForImage } from './helpers';

test('previews and exports a 6000×4000 image at full resolution in the worker', async ({ page }, testInfo) => {
  test.setTimeout(55_000);
  const fixture = 'large-6000x4000.jpg';
  await openImageWorkspace(page);
  const previewStart = timer.now();
  await pick(page, fixture);
  await waitForImage(page, fixture);
  const preview = page.getByRole('img', { name: `Preview of ${fixture}` });
  const previewDimensions = await preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  const previewMs = Math.round(timer.now() - previewStart);
  expect(previewDimensions).toEqual([1400, 933]);
  await expect(page.getByText('6000 × 4000 px')).toBeVisible();

  await applyConversion(page, 'JPG', 70);
  await expect(page.getByText('JPG · Quality 70%')).toBeVisible();
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
  expect(uiFrameMs).toBeLessThan(1_500);
  expect(previewMs).toBeLessThan(20_000);
  expect(exportMs).toBeLessThan(25_000);

  const timings = { project: testInfo.project.name, format: 'JPG', quality: 70, previewMs, exportMs, uiFrameMs: Math.round(uiFrameMs) };
  console.log(`FileKit timing ${JSON.stringify(timings)}`);
  await testInfo.attach('timings', { body: JSON.stringify(timings), contentType: 'application/json' });
});
