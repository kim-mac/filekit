import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import {
  applyConversion, downloadResult, fileRow, fixturePath, openImageWorkspace, outputFormat, pick, selectFormat, setSlider,
  toolTab, waitForFonts, waitForImage,
} from './helpers';

test.use({ colorScheme: 'light' });

test('opens the picker from Preview and the add tile, and downloads a nonselected file with its saved edits', async ({ page, isMobile }) => {
  await openImageWorkspace(page);
  const preview = page.getByRole('region', { name: 'Preview' });
  const [first] = await Promise.all([
    page.waitForEvent('filechooser'), preview.getByRole('button', { name: /Drop images here/ }).click(),
  ]);
  await first.setFiles(fixturePath('transparent.png'));
  await waitForImage(page, 'transparent.png');
  await applyConversion(page, 'JPG', 90, '#000000');
  const [more] = await Promise.all([
    page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add more images' }).click(),
  ]);
  await more.setFiles(fixturePath('reference.webp'));
  const other = fileRow(page, 'reference.webp').getByRole('button', { name: /reference.webp.*Ready/ });
  await other.click();
  await waitForImage(page, 'reference.webp');
  await expect(other).toHaveAttribute('aria-current', 'true');
  const firstTile = fileRow(page, 'transparent.png');
  const download = firstTile.getByRole('button', { name: 'Download transparent.png' });
  if (!isMobile) {
    await page.locator('h1').hover();
    await expect(firstTile.locator('.file-actions')).toHaveCSS('opacity', '0');
    await firstTile.hover();
  }
  await expect(firstTile.locator('.file-actions')).toHaveCSS('opacity', '1');
  const [output] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(output.suggestedFilename()).toBe('transparent.jpg');
  const jpg = sharp(await readFile((await output.path())!));
  expect(await jpg.metadata()).toMatchObject({ width: 96, height: 64, format: 'jpeg' });
  const black = await jpg.extract({ left: 8, top: 8, width: 1, height: 1 }).raw().toBuffer();
  expect(Math.max(...black)).toBeLessThan(5);
  await expect(other).toHaveAttribute('aria-current', 'true');
  if (!isMobile) await firstTile.hover();
  await firstTile.getByRole('button', { name: 'Remove transparent.png' }).click();
  await expect(firstTile).toHaveCount(0);
});

test('selects the HEIC fallback and exports new formats through the same-origin WASM codec', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'iphone-webkit', 'Covers desktop and iOS worker paths');
  let codecRequests = 0;
  context.on('request', request => {
    if (new URL(request.url()).pathname === '/workers/magick.wasm') codecRequests++;
  });
  await openImageWorkspace(page);
  await pick(page, 'reference.heic', 'transparent.png');
  await waitForImage(page, 'reference.heic');
  await expect(page.getByText('Original format: HEIC')).toBeVisible();
  await expect(outputFormat(page)).toHaveText('Keep original format');
  await expect(page.getByText('HEIC input is exported as JPG.')).toBeVisible();
  expect((await downloadResult(page, 'Export image')).name).toBe('reference.jpg');
  expect(codecRequests).toBe(0);

  await fileRow(page, 'transparent.png').getByRole('button', { name: /transparent.png.*Ready/ }).click();
  await waitForImage(page, 'transparent.png');
  await applyConversion(page, 'BMP', undefined, '#104e32');
  expect((await downloadResult(page, 'Export image')).bytes.subarray(0, 2).toString()).toBe('BM');
  expect(codecRequests).toBe(1);
  await selectFormat(page, 'ICO');
  const controls = page.getByRole('region', { name: 'Tools' });
  await expect(controls.getByLabel('Fill transparent areas with')).toHaveCount(0);
  await controls.getByRole('button', { name: '16 px', exact: true }).click();
  await controls.getByRole('button', { name: 'Apply convert' }).click();
  const ico = await downloadResult(page, 'Export image');
  expect(ico.name).toBe('transparent.ico');
  expect(ico.bytes.readUInt16LE(4)).toBe(5);
  expect(ico.bytes[6]).toBe(32);
  expect(codecRequests).toBe(1);
});

async function imageReady(page: Page, name: string) {
  await page.getByRole('img', { name, exact: true }).evaluate((element: HTMLImageElement) => element.decode());
}

test('compares an edited image with matching framing and captures each workspace state', async ({ page, isMobile }, testInfo) => {
  const screenshots = ['desktop-chromium', 'android-chromium'].includes(testInfo.project.name);
  const capture = async (state: string) => {
    if (!screenshots) return;
    await page.evaluate(() => scrollTo(0, 0));
    if (!isMobile) await page.locator('h1').hover();
    await waitForFonts(page);
    await expect(page).toHaveScreenshot(`workspace-${state}.png`, { fullPage: true, animations: 'disabled', maxDiffPixelRatio: 0.04 });
  };

  await openImageWorkspace(page);
  await capture('empty');
  await pick(page, 'bg/portrait-wind.jpg', 'transparent.png', 'reference.webp');
  await waitForImage(page, 'portrait-wind.jpg');
  await expect(fileRow(page, 'reference.webp')).toContainText('Ready');
  await imageReady(page, 'Preview of portrait-wind.jpg');
  await capture('loaded');

  await toolTab(page, 'Crop').click();
  await page.getByRole('radio', { name: '1:1', exact: true }).check();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await toolTab(page, 'Blur').click();
  await page.getByRole('checkbox', { name: 'Invert selected regions' }).check();
  await setSlider(page.getByRole('slider', { name: 'Strength' }), 100);
  await page.getByRole('button', { name: 'Apply blur' }).click();
  const toggle = page.getByRole('button', { name: 'Compare', exact: true });
  await toggle.click();
  await imageReady(page, 'Original framing of portrait-wind.jpg');
  await imageReady(page, 'Preview of portrait-wind.jpg');
  const dimensions = (name: string) => page.getByRole('img', { name, exact: true }).evaluate((image: HTMLImageElement) => ({
    width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height,
  }));
  expect(await dimensions('Original framing of portrait-wind.jpg')).toEqual(await dimensions('Preview of portrait-wind.jpg'));
  const split = page.getByRole('slider', { name: 'Before and after split' });
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await split.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '51');
  if (!isMobile) {
    const divider = (await split.boundingBox())!;
    const image = (await page.locator('.preview-media').boundingBox())!;
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(image.x + image.width * 0.67, divider.y + divider.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(Number(await split.getAttribute('aria-valuenow'))).toBeGreaterThan(60);
  }
  await setSlider(split, 50);
  await capture('before-after');
  await toggle.click();
  await expect(split).toHaveCount(0);

  await fileRow(page, 'transparent.png').getByRole('button', { name: /transparent.png.*Ready/ }).click();
  await toolTab(page, 'Convert').click();
  await waitForImage(page, 'transparent.png');
  await imageReady(page, 'Preview of transparent.png');
  await selectFormat(page, 'JPG');
  await expect(page.getByRole('region', { name: 'Tools' }).getByLabel('Fill transparent areas with')).toHaveValue('#ffffff');
  await capture('convert');
  await toolTab(page, 'Remove background').click();
  await expect(page.getByRole('radio', { name: 'Blur background (portrait effect)' })).toHaveAccessibleDescription(/keep the subject sharp/);
  await expect(page.getByText('JPG fill color')).toHaveCount(0);
  await capture('remove-background');
});
