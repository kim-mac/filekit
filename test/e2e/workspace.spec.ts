import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import {
  applyConversion, downloadResult, fileRow, fixturePath, formatChoice, openImageWorkspace, pick, sendFiles, sha256,
  status, waitForImage,
} from './helpers';

test('intake through picker, drop, and paste isolates corrupt and unsupported files', async ({ page, isMobile }) => {
  await openImageWorkspace(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    isMobile ? page.getByRole('button', { name: 'Add images' }).tap() : page.keyboard.press('Control+o'),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(['oriented.jpg', 'reference.heic', 'broken.jpg'].map(fixturePath));
  await sendFiles(page, 'drop', ['reference.avif', 'unsupported.txt']);
  await sendFiles(page, 'paste', ['animated.gif', 'reference.webp', 'transparent.png']);

  await waitForImage(page, 'oriented.jpg');
  await expect(page.getByText('64 × 96 px')).toBeVisible();
  await expect(fileRow(page, 'broken.jpg')).toContainText('could not be decoded');
  await expect(fileRow(page, 'unsupported.txt')).toContainText('Unsupported image');
  for (const name of ['reference.heic', 'reference.avif', 'animated.gif', 'reference.webp', 'transparent.png']) {
    await expect(fileRow(page, name)).toContainText('Ready');
  }

  if (isMobile) {
    await page.locator('.preview-stage').evaluate((stage) => {
      stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 220, clientY: 80 }));
      stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 110, clientY: 80 }));
    });
  } else {
    await page.getByRole('button', { name: 'Next image' }).click();
  }
  await waitForImage(page, 'reference.heic');
  await expect(page.getByText('96 × 64 px')).toBeVisible();
  await page.getByRole('button', { name: 'Remove broken.jpg' }).click();
  await expect(fileRow(page, 'broken.jpg')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeEnabled();
});

// Each project compares its download to the same byte-level goldens.
const conversionDigests = {
  JPG: '291151fa7d8dbfb9584df2bfeec245314f3cad0540115d4ed9dad6754e49a6d6',
  PNG: '80905c4e06a27fa104bffa7bba8aa055b2e69c996f35b1814914e3044fad79db',
  WebP: '519d34ae60a935d61367056db1d80fac5fb6e0f3f798d376b3ee0674cffe07b2',
  AVIF: '4a2492158d7b0efb7218bb444caa22f3bf365b8e5857f915e9af440c90f48c21',
};

for (const [label, format, extension] of [
  ['JPG', 'jpeg', 'jpg'], ['PNG', 'png', 'png'], ['WebP', 'webp', 'webp'], ['AVIF', 'heif', 'avif'],
] as const) {
  test(`converts to ${label} with the same dimensions, controls, and quality`, async ({ page }) => {
    await openImageWorkspace(page);
    await pick(page, 'transparent.png');
    await waitForImage(page, 'transparent.png');
    await expect(page.getByRole('button', { name: 'Convert', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Exports use the original pixels and strip EXIF metadata.')).toBeVisible();
    for (const choice of ['JPG', 'PNG', 'WebP', 'AVIF']) await expect(formatChoice(page, choice)).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Quality' })).toHaveCount(0);

    const quality = label === 'PNG' ? undefined : 60;
    await applyConversion(page, label, quality, label === 'JPG' ? 'Black' : undefined);
    if (quality) await expect(page.getByRole('slider', { name: 'Quality' })).toHaveValue(String(quality));
    if (label === 'JPG') await expect(page.getByText('JPG · Quality 60% · Black background')).toBeVisible();
    const result = await downloadResult(page, 'Export image');
    expect(result.name).toBe(`transparent.${extension}`);
    const image = sharp(result.bytes);
    const metadata = await image.metadata();
    expect(metadata).toMatchObject({ width: 96, height: 64, format, hasAlpha: format !== 'jpeg' });
    const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (format === 'jpeg') expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    else expect(data[3]).toBe(0);
    if (label === 'AVIF') expect(metadata.compression).toBe('av1');
    expect(sha256(result.bytes)).toBe(conversionDigests[label]);
  });
}

test('undo and redo are per file and ZIP uses each active edit history', async ({ page, isMobile }) => {
  await openImageWorkspace(page);
  await pick(page, 'oriented.jpg', 'transparent.png', 'unsupported.txt');
  await waitForImage(page, 'oriented.jpg');
  await applyConversion(page, 'WebP', 67);
  await applyConversion(page, 'PNG');

  if (isMobile) await page.getByRole('button', { name: 'Undo' }).click();
  else await page.keyboard.press('Control+z');
  await expect(page.getByText('WebP · Quality 67%')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(formatChoice(page, 'PNG')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(formatChoice(page, 'WebP')).toBeChecked();

  await applyConversion(page, 'JPG', 92);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await fileRow(page, 'transparent.png').getByRole('button', { name: /transparent.png.*Ready/ }).click();
  await waitForImage(page, 'transparent.png');
  await expect(formatChoice(page, 'PNG')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  const result = await downloadResult(page, 'Export ZIP');
  expect(result.name).toBe('filekit-images.zip');
  await expect(status(page)).toHaveText('ZIP ready to save with 2 images.');
  const entries = unzipSync(result.bytes);
  expect(Object.keys(entries)).toEqual(['oriented.jpg', 'transparent.png']);
  const oriented = await sharp(entries['oriented.jpg']).metadata();
  expect(oriented).toMatchObject({ format: 'jpeg', width: 64, height: 96 });
  expect(oriented.exif).toBeUndefined();
  expect(oriented.orientation).toBeUndefined();
  expect(await sharp(entries['transparent.png']).metadata()).toMatchObject({ format: 'png', width: 96, height: 64, hasAlpha: true });
});

test('reports progress and cancels a worker export before a successful retry', async ({ page }) => {
  await openImageWorkspace(page);
  await pick(page, 'transparent.png');
  await waitForImage(page, 'transparent.png');
  await applyConversion(page, 'JPG', 60, 'Black');

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const encoder = /mozjpeg_enc.*\.wasm/;
  await page.context().route(encoder, async (route) => {
    await gate;
    await route.continue().catch(() => {}); // Canceling terminates the worker holding this request.
  });
  await page.getByRole('button', { name: 'Export image' }).click();
  try {
    await expect(status(page)).toHaveText('Encoding 1 of 1…');
    await page.getByRole('button', { name: 'Cancel export' }).click();
    await expect(status(page)).toHaveText('Export canceled.');
    await expect(page.getByRole('link', { name: 'Save to device' })).toHaveCount(0);
  } finally {
    release();
    await page.context().unroute(encoder);
  }
  expect((await downloadResult(page, 'Export image')).name).toBe('transparent.jpg');
});

test('cancels preview intake and retries the same file', async ({ page, context }) => {
  await openImageWorkspace(page);
  const workerUrl = '**/workers/image.worker.js';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route(workerUrl, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });

  await pick(page, 'transparent.png');
  try {
    await expect(status(page)).toHaveText('Checking transparent.png…');
    await page.getByRole('button', { name: 'Cancel preview' }).click();
    await expect(page.getByText('Preview canceled.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export image' })).toBeDisabled();
  } finally {
    release();
    await context.unroute(workerUrl);
  }
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await waitForImage(page, 'transparent.png');
});
