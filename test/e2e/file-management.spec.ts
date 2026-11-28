import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { applyConversion, downloadResult, fileRow, openImageWorkspace, pick, toolTab, waitForImage } from './helpers';

const names = ['oriented.png', 'transparent.png', 'reference.webp'];
const fileNames = (page: Page) => page.locator('.file-tile .file-name');
const tileButton = (page: Page, name: string) => fileRow(page, name).locator('.select-file');

async function setupFiles(page: Page) {
  await openImageWorkspace(page);
  await pick(page, ...names);
  await waitForImage(page, names[0]);
  await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeEnabled();
}

test('drags thumbnails with a mouse or native touch', async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== 'chromium', 'Pointer coverage uses Chromium mouse and native CDP touch input');
  await setupFiles(page);
  const fromThumb = fileRow(page, names[0]).locator('.file-thumbnail');
  const toThumb = fileRow(page, names[1]).locator('.file-thumbnail');
  await fromThumb.scrollIntoViewIfNeeded();
  const start = (await fromThumb.boundingBox())!;
  const end = (await toThumb.boundingBox())!;
  const from = { x: Math.round(start.x + start.width * 0.5), y: Math.round(start.y + start.height * 0.8) };
  const to = { x: Math.round(end.x + end.width * 0.4), y: from.y };

  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  }

  await expect(fileNames(page)).toHaveText([names[1], names[0], names[2]]);
  await expect(page.locator('.preview-navigation')).toContainText('2 / 3');
  await page.getByRole('button', { name: 'Previous image' }).click();
  await waitForImage(page, names[1]);
});

test('reorders by keyboard and file menu and keeps renamed ZIP entries in order', async ({ page, isMobile }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'android-chromium',
    'Covers desktop keyboard and touch menu controls');
  await setupFiles(page);
  const selected = tileButton(page, names[0]);
  if (!isMobile) {
    await selected.focus();
    await selected.press('Alt+ArrowRight');
    await expect(fileNames(page)).toHaveText([names[1], names[0], names[2]]);
    await expect(selected).toBeFocused();
    await selected.press('ControlOrMeta+ArrowRight');
    await expect(fileNames(page)).toHaveText([names[1], names[2], names[0]]);
  }
  const movingFile = isMobile ? names[0] : names[2];
  const tile = fileRow(page, movingFile);
  if (!isMobile) await tile.hover();
  await tile.getByRole('button', { name: `Actions for ${movingFile}` }).click();
  const desired = isMobile ? 'Move right' : 'Move left';
  await page.getByRole('menuitem', { name: desired }).click();
  await expect(fileNames(page)).toHaveText(isMobile ? [names[1], names[0], names[2]] : [names[2], names[1], names[0]]);

  async function openRename(name: string) {
    const row = fileRow(page, name);
    if (!isMobile) await row.hover();
    await row.getByRole('button', { name: `Rename ${name}` }).click();
    const input = page.getByRole('textbox', { name: 'File name' });
    await expect(input).toBeFocused();
    return input;
  }

  const first = await openRename(names[0]);
  await expect(first).toHaveValue('oriented');
  await first.fill(' ... ');
  await first.press('Enter');
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a file name.' })).toHaveText('Enter a file name.');
  await first.fill('Discard me');
  await first.press('Escape');
  await expect(tileButton(page, names[0])).toBeVisible();

  const raw = '  Trip: A/B*?  ';
  const sanitized = 'Trip_ A_B__';
  for (const name of [names[0], names[1]]) {
    const input = await openRename(name);
    await input.fill(raw);
    await input.press('Enter');
  }
  const renamed = `${sanitized}.png`;
  await expect(fileNames(page).filter({ hasText: renamed })).toHaveCount(2);

  await page.locator('.file-tile').filter({ has: page.locator('[aria-current="true"]') }).locator('.select-file').focus();
  await toolTab(page, 'Crop').click();
  await toolTab(page, 'Convert').click();
  const zip = await downloadResult(page, 'Export ZIP');
  const entries = unzipSync(zip.bytes);
  const expectedNames = [renamed, `${sanitized} (2).png`];
  if (isMobile) expectedNames.push('reference.webp');
  else expectedNames.unshift('reference.webp');
  expect(Object.keys(entries)).toEqual(expectedNames);
  expect(await sharp(entries[renamed]).metadata()).toMatchObject({ width: 96, height: 64 });
  expect(await sharp(entries[`${sanitized} (2).png`]).metadata()).toMatchObject({ width: 64, height: 96 });

  await applyConversion(page, 'JPG');
  await expect(fileNames(page).filter({ hasText: `${sanitized}.jpg` })).toHaveCount(1);
  expect((await downloadResult(page, 'Export image')).name).toBe(`${sanitized}.jpg`);
});
