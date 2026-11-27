import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import {
  downloadResult, openImageWorkspace, pick, selectFormat, setSlider, toolTab,
  waitForEstimates, waitForFonts, waitForImage,
} from './helpers';

test('updates estimates as lossy quality and output format change', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covers the full format list on desktop Chromium');
  test.setTimeout(90_000);
  await openImageWorkspace(page);
  await pick(page, 'oriented.jpg');
  await waitForImage(page, 'oriented.jpg');
  const tools = page.getByRole('region', { name: 'Tools' });
  const estimate = tools.locator('.output-estimate strong');
  const slider = tools.getByRole('slider', { name: 'Quality' });
  await expect(slider).toHaveAccessibleDescription('Higher = better look, bigger file');
  await expect(estimate).toHaveText(/^≈ /, { timeout: 15_000 });
  const at85 = await estimate.textContent();
  await setSlider(slider, 15);
  await expect(estimate).toHaveText(/^≈ /, { timeout: 15_000 });
  await expect(estimate).not.toHaveText(at85!);

  for (const label of ['JPG (JPEG)', 'WebP', 'AVIF']) {
    await selectFormat(page, label);
    await expect(slider).toBeVisible();
    await expect(estimate).toHaveText(/^≈ /, { timeout: 15_000 });
  }
  for (const label of ['PNG', 'GIF', 'BMP', 'TIFF', 'ICO']) {
    await selectFormat(page, label);
    await expect(slider).toHaveCount(0);
    await expect(estimate).toHaveText(/^≈ /, { timeout: 15_000 });
  }
  await expect(tools.getByText(/256 × 256 px in one file/)).toBeVisible();
  const original = page.getByRole('region', { name: 'Export' });
  await expect(original.getByText(/JPG \(JPEG\) · Quality 85%/)).toBeVisible();
  await tools.getByRole('button', { name: 'Apply convert' }).click();
  await expect(original.getByText(/256 × 256 px/)).toBeVisible();
});

test('reads original metadata locally, strips GPS on export and captures dark mode', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'android-chromium'].includes(testInfo.project.name), 'Dark snapshots for desktop and mobile Chromium');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openImageWorkspace(page);
  await pick(page, 'location-metadata.jpg', 'transparent.png');
  await waitForImage(page, 'location-metadata.jpg');
  const facts = page.locator('.preview-facts');
  await expect(facts).toContainText('96 × 64 px · 1.2 kB');
  await facts.getByRole('button', { name: 'Details' }).click();
  const details = page.getByRole('dialog', { name: 'Original image details' });
  for (const text of ['JPG (JPEG)', 'RGB', '8 bit', 'No', 'FileKit Test Camera', 'Sample One', '2024-06-15 12:30:00 +00:00',
    'sRGB', 'Contains location data — removed on export.']) {
    await expect(details.getByText(text, { exact: true })).toBeVisible();
  }
  await waitForFonts(page);
  await waitForEstimates(page);
  await expect(page).toHaveScreenshot('workspace-details-dark.png', { fullPage: true, animations: 'disabled', maxDiffPixelRatio: 0.04 });
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  const { bytes } = await downloadResult(page, 'Export image');
  expect((await sharp(bytes).metadata()).exif).toBeUndefined();
});

test('zooms, pans, compares and maps drawing coordinates in the shared desktop viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Covers desktop pointer gestures and shortcuts');
  test.setTimeout(60_000);
  await openImageWorkspace(page);
  await pick(page, 'oriented.png');
  await waitForImage(page, 'oriented.png');
  const stage = page.locator('.preview-stage');
  const image = page.getByRole('img', { name: 'Preview of oriented.png' });
  const percent = page.getByLabel('Zoom percentage');
  const mouseDrag = async (from: { x: number; y: number }, to: { x: number; y: number }, button: 'left' | 'middle' = 'left') => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up({ button });
  };
  await stage.dblclick();
  await expect(percent).toHaveText('100%');
  await stage.dblclick();
  await expect(stage).toHaveAttribute('data-zoom', '1');
  await stage.hover();
  await page.mouse.wheel(0, -90);
  await expect.poll(async () => Number(await stage.getAttribute('data-zoom'))).toBeGreaterThan(1);
  const before = (await image.boundingBox())!;
  const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await mouseDrag(center, { x: center.x + 28, y: center.y + 17 });
  await expect.poll(async () => (await image.boundingBox())!.x).toBeCloseTo(before.x + 28, 0);

  await toolTab(page, 'Blur').click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const frame = page.locator('.blur-frame');
  const imageFrame = (await frame.boundingBox())!;
  const point = (x: number, y: number, box = imageFrame) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const start = point(0.45, 0.45);
  await page.keyboard.down('Space');
  await mouseDrag(start, { x: start.x - 21, y: start.y - 9 });
  await page.keyboard.up('Space');
  await expect.poll(async () => (await frame.boundingBox())!.x).toBeCloseTo(imageFrame.x - 21, 0);
  await expect(page.getByRole('group', { name: 'Blur rectangle 1' })).toHaveCount(0);
  const moved = (await frame.boundingBox())!;
  await mouseDrag(point(0.35, 0.35, moved), point(0.60, 0.62, moved));
  const rectangle = page.getByRole('group', { name: 'Blur rectangle 1' });
  await expect(rectangle).toBeVisible();
  const drawn = (await rectangle.boundingBox())!;
  expect((drawn.x - moved.x) / moved.width).toBeCloseTo(0.35, 1);
  expect(drawn.width / moved.width).toBeCloseTo(0.25, 1);
  await page.getByRole('button', { name: 'Apply blur' }).click();

  await page.getByRole('button', { name: 'Compare' }).click();
  const original = page.getByRole('img', { name: 'Original framing of oriented.png' });
  await expect(original).toBeVisible();
  expect(await original.boundingBox()).toEqual(await image.boundingBox());
  await page.getByRole('button', { name: 'Compare' }).click();

  await toolTab(page, 'Crop').click();
  await page.getByRole('radio', { name: '1:1', exact: true }).check();
  const box = page.getByRole('group', { name: 'Crop box' });
  const oldCrop = (await box.boundingBox())!;
  const cropCenter = point(0.5, 0.5, oldCrop);
  await mouseDrag(cropCenter, { x: cropCenter.x + 15, y: cropCenter.y + 6 }, 'middle');
  await expect.poll(async () => (await box.boundingBox())!.x).toBeCloseTo(oldCrop.x + 15, 0);
  const handle = page.getByRole('button', { name: 'Resize crop from bottom right' });
  const corner = point(0.5, 0.5, (await handle.boundingBox())!);
  await mouseDrag(corner, { x: corner.x - 28, y: corner.y - 28 });
  await expect.poll(async () => (await box.boundingBox())!.width).toBeLessThan(oldCrop.width - 15);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(stage).toHaveAttribute('data-zoom', '1');
});
