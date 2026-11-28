import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { applyConversion, fileRow, openImageWorkspace, pick, savedLink, toolTab, waitForImage } from './helpers';

const copyButton = (page: Page) => page.getByRole('button', { name: 'Copy image', exact: true });
const copyStatus = (page: Page) => page.getByRole('region', { name: 'Export' }).getByRole('status').filter({ hasText: /^Copied$/ });

async function readPng(page: Page) {
  return Buffer.from(await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find(item => item.types.includes('image/png'));
    if (!item) throw new Error('Clipboard did not contain a PNG.');
    return Array.from(new Uint8Array(await (await item.getType('image/png')).arrayBuffer()));
  }));
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'Clipboard permission and memory coverage runs on desktop Chromium');
});

test('copies edited full-resolution PNG pixels, supports the file action and shortcut, and pastes a new file', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageWorkspace(page);
  const name = 'transparent-large.png';
  const buffer = await sharp({ create: {
    width: 3000, height: 2200, channels: 4, background: { r: 92, g: 128, b: 148, alpha: 0.5 },
  } }).png().toBuffer();
  await page.getByLabel('Image files').setInputFiles({ name, mimeType: 'image/png', buffer });
  await waitForImage(page, name);
  await applyConversion(page, 'JPG', 80);
  await toolTab(page, 'Crop').click();
  await page.getByRole('radio', { name: '4:5', exact: true }).check();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await expect(page.locator('.preview-dimensions')).toHaveText('1760 × 2200 px');
  const releaseClipboard = await page.evaluateHandle(() => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const NativeClipboardItem = window.ClipboardItem;
    window.ClipboardItem = class extends NativeClipboardItem {
      constructor(items: Record<string, string | Blob | PromiseLike<string | Blob>>) {
        const png = items['image/png'];
        if (!(png instanceof Promise) || !navigator.userActivation.isActive) {
          throw new Error('Clipboard write needs a pending PNG in the user gesture.');
        }
        super({ 'image/png': gate.then(() => png) });
      }
    };
    return release;
  });
  await copyButton(page).click();
  await expect(page.getByRole('region', { name: 'Export' }).getByRole('status').filter({ hasText: /^Copying…$/ })).toBeVisible();
  await releaseClipboard.evaluate(release => release());
  await expect(copyStatus(page)).toBeVisible();
  const image = sharp(await readPng(page));
  expect(await image.metadata()).toMatchObject({ format: 'png', width: 1760, height: 2200, hasAlpha: true });
  expect((await image.extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())[3]).toBe(128);
  await expect(page.getByText('JPG (JPEG) · Quality 80%')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.preview-dimensions')).toHaveText('3000 × 2200 px');
  await expect(copyButton(page)).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(copyStatus(page)).toBeVisible();
  expect(await sharp(await readPng(page)).metadata()).toMatchObject({ width: 3000, height: 2200 });

  await pick(page, 'oriented.png');
  const second = fileRow(page, 'oriented.png');
  await expect(second).toContainText('Ready');
  await second.hover();
  const fileActions = second.getByRole('button', { name: 'Actions for oriented.png' });
  await fileActions.click();
  await page.getByRole('menuitem', { name: 'Copy image' }).click();
  await expect(second).toContainText('Copied');
  await expect(fileActions).toBeFocused();
  expect(await sharp(await readPng(page)).metadata()).toMatchObject({ width: 64, height: 96 });

  await page.getByRole('button', { name: 'Add more images' }).focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(fileRow(page, 'image.png')).toContainText('Ready');
  await expect(page.getByRole('list', { name: 'Added files' }).locator('.file-tile')).toHaveCount(3);

  await second.hover();
  await second.getByRole('button', { name: 'Rename oriented.png' }).click();
  const filename = page.getByRole('textbox', { name: 'File name' });
  await expect(filename).toBeFocused();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('oriented');
});

test('warns before encoding an image over 40 megapixels', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageWorkspace(page);
  const name = '41-megapixels.jpg';
  const buffer = await sharp({ create: {
    width: 8200, height: 5000, channels: 3, background: '#515151',
  } }).jpeg().toBuffer();
  await page.getByLabel('Image files').setInputFiles({ name, mimeType: 'image/jpeg', buffer });
  await waitForImage(page, name);
  await copyButton(page).click();
  await expect(page.getByText('This image is over 40 megapixels. Some apps may reject it when you paste.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy anyway' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export instead' })).toBeEnabled();
});

for (const scenario of ['unsupported', 'blocked'] as const) {
  test(`provides an export fallback when clipboard writing is ${scenario}`, async ({ page }) => {
    await page.addInitScript(scenario => {
      if (scenario === 'unsupported') {
        Object.defineProperty(navigator, 'clipboard', { value: undefined });
      } else {
        navigator.clipboard.write = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
      }
    }, scenario);
    await openImageWorkspace(page);
    await pick(page, 'transparent.png');
    await waitForImage(page, 'transparent.png');
    await copyButton(page).click();
    await expect(page.getByRole('region', { name: 'Export' }).getByRole('alert')).toContainText(scenario === 'unsupported'
      ? 'This browser does not support copying images'
      : 'Clipboard access was blocked');
    await page.getByRole('button', { name: 'Export instead' }).click();
    await expect(savedLink(page)).toHaveAttribute('download', 'transparent.png');
  });
}
