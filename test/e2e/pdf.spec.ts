import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { fixturePath, waitForFonts } from './helpers';

const pageButton = (page: Page, number: number) => page.getByRole('button', { name: `Page ${number}`, exact: true });
const selectTool = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
const files = (page: Page) => page.getByRole('region', { name: 'Files' });
const organize = (page: Page, name: string) => page.getByRole('tabpanel', { name: 'Organize' }).getByRole('button', { name, exact: true });
const history = (page: Page, name: 'Undo' | 'Redo') => page.getByRole('button', { name, exact: true }).click();
test.describe.configure({ timeout: 45_000 });

async function open(page: Page, ...names: string[]) {
  await page.goto('/pdf/');
  const picker = page.getByLabel('PDF and image files');
  await expect(picker).toBeEnabled({ timeout: 15_000 });
  await picker.setInputFiles(names.map(fixturePath));
  if (names.length && !names[0].includes('encrypted')) await expect(pageButton(page, 1)).toBeVisible({ timeout: 15_000 });
}

async function download(page: Page, action: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const link = page.getByRole('link', { name: 'Save to device' });
  await expect(link).toBeVisible({ timeout: 25_000 });
  const [result] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return { name: result.suggestedFilename(), bytes: await readFile((await result.path())!) };
}

test('organizes, previews and exports edited pages', async ({ page }) => {
  await open(page, 'pdf/mixed.pdf');
  await expect(pageButton(page, 1)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview' }).locator('img').first()).toBeVisible();
  await pageButton(page, 1).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(pageButton(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await organize(page, 'Rotate right').click();
  await pageButton(page, 3).click();
  await organize(page, 'Delete').click();
  await history(page, 'Undo');
  await expect(pageButton(page, 4)).toBeVisible();
  await history(page, 'Redo');
  await expect(pageButton(page, 4)).toHaveCount(0);
  await pageButton(page, 2).click();
  await page.getByRole('button', { name: 'Single page' }).click();
  await expect(page.getByRole('img', { name: 'Preview of page 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'PDF document details' })).toContainText('400 × 300 pt');
  await page.keyboard.press('Escape');
  const output = await download(page, 'Export PDF');
  expect(output.name).toBe('mixed.pdf');
  const pdf = await PDFDocument.load(output.bytes);
  expect(pdf.getPages().map(item => [item.getWidth(), item.getRotation().angle])).toEqual([[350, 90], [300, 90], [300, 0]]);
});

test('applies Organize buttons immediately and disables them without a selection', async ({ page }) => {
  await open(page, 'pdf/mixed.pdf');
  const actions = ['Rotate left', 'Rotate right', 'Delete', 'Duplicate', 'Insert blank page'];
  await expect(page.getByRole('button', { name: 'Apply organize' })).toHaveCount(0);
  await expect(page.getByLabel('Page action')).toHaveCount(0);
  await pageButton(page, 1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByText('Select pages to edit', { exact: true })).toBeVisible();
  for (const action of actions) await expect(organize(page, action)).toBeDisabled();

  await pageButton(page, 2).click();
  await pageButton(page, 3).click({ modifiers: ['Shift'] });
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await organize(page, 'Rotate left').click();
  await organize(page, 'Duplicate').click();
  await history(page, 'Undo');
  await expect(pageButton(page, 5)).toHaveCount(0);
  await history(page, 'Redo');
  await expect(pageButton(page, 6)).toBeVisible();
  await organize(page, 'Insert blank page').click();
  await history(page, 'Undo');
  await expect(pageButton(page, 7)).toHaveCount(0);
  await history(page, 'Redo');
  const output = await download(page, 'Export PDF');
  const pdf = await PDFDocument.load(output.bytes);
  expect(pdf.getPages().map(item => [item.getWidth(), item.getRotation().angle])).toEqual([
    [300, 0], [350, 0], [350, 0], [400, 270], [595.28, 0], [400, 270], [300, 0],
  ]);
});

test('shows page quick actions on hover or touch and edits only that page', async ({ page, isMobile }) => {
  await open(page, 'pdf/mixed.pdf');
  const rotate = page.getByRole('button', { name: 'Rotate page 2' });
  const remove = page.getByRole('button', { name: 'Delete page 3' });
  if (!isMobile) {
    await expect(rotate).toHaveCSS('pointer-events', 'none');
    await pageButton(page, 2).hover();
  }
  await expect(rotate).toHaveCSS('pointer-events', 'auto');
  if (isMobile) await rotate.tap();
  else await rotate.click();
  if (!isMobile) await pageButton(page, 3).hover();
  await expect(remove).toHaveCSS('pointer-events', 'auto');
  if (isMobile) await remove.tap();
  else await remove.click();
  await expect(pageButton(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await history(page, 'Undo');
  await expect(pageButton(page, 4)).toBeVisible();
  await history(page, 'Redo');
  await expect(pageButton(page, 4)).toHaveCount(0);
  const { bytes } = await download(page, 'Export PDF');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPages().map(item => [item.getWidth(), item.getRotation().angle])).toEqual([[300, 0], [350, 180], [300, 0]]);
});

test('uses keyboard shortcuts to edit pages and preserves native shortcuts in text fields', async ({ page }) => {
  await open(page, 'pdf/mixed.pdf');
  await pageButton(page, 3).click();
  await page.keyboard.press('r');
  await page.keyboard.press('Shift+R');
  await page.keyboard.press('Shift+R');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(pageButton(page, 5)).toBeVisible();
  await pageButton(page, 1).click();
  await page.keyboard.press('Delete');
  await expect(pageButton(page, 5)).toHaveCount(0);
  await expect(pageButton(page, 1)).toBeFocused();
  await pageButton(page, 4).click();
  await page.keyboard.press('Backspace');
  await expect(pageButton(page, 4)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(pageButton(page, 4)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(pageButton(page, 4)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible();

  await selectTool(page, 'Split / extract');
  await page.getByLabel('Split method').selectOption('extract-ranges');
  const ranges = page.getByLabel('Page ranges');
  await ranges.fill('1-3');
  await ranges.press('ControlOrMeta+a');
  await ranges.press('Backspace');
  await expect(ranges).toBeEmpty();
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
  const { bytes } = await download(page, 'Export PDF');
  expect((await PDFDocument.load(bytes)).getPages().map(item => [item.getWidth(), item.getRotation().angle]))
    .toEqual([[350, 90], [400, 270], [400, 270]]);
});

test('renders each PDF’s current first page in the Files strip', async ({ page }) => {
  await open(page, 'pdf/mixed.pdf', 'pdf/scan.pdf');
  const mixed = files(page).getByRole('button', { name: /^mixed\.pdf/ });
  const scan = files(page).getByRole('button', { name: /^scan\.pdf/ });
  for (const [tile, count] of [[mixed, '4 pages'], [scan, '1 page']] as const) {
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toContainText(count);
    await expect(tile.locator('img')).toBeVisible();
    await expect.poll(() => tile.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(tile.locator('img')).toHaveAttribute('src', /^blob:/);
  }
  await mixed.scrollIntoViewIfNeeded();
  const first = await mixed.locator('img').getAttribute('src');
  await organize(page, 'Delete').click();
  await expect(mixed).toContainText('3 pages');
  await expect(mixed.locator('img')).not.toHaveAttribute('src', first!);
  await history(page, 'Undo');
  await expect(mixed).toContainText('4 pages');

  const buffer = await readFile(fixturePath('pdf/scan.pdf'));
  await page.getByLabel('PDF and image files').setInputFiles(Array.from({ length: 8 }, (_, index) => ({
    name: `scan-${index + 1}.pdf`, mimeType: 'application/pdf', buffer,
  })));
  const last = files(page).getByRole('button', { name: /^scan-8\.pdf/ });
  await expect(last).toContainText('1 page', { timeout: 15_000 });
  await expect(last.locator('img')).toHaveCount(0);
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('img')).toHaveAttribute('src', /^blob:/);
});

test('drags pages with a mouse or touch and copies pages between desktop files', async ({ page, isMobile, browserName }) => {
  test.skip(isMobile && browserName !== 'chromium', 'The touch drag driver uses Chromium CDP. Keyboard reorder runs on every project.');
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 1080 });
  await open(page, 'pdf/mixed.pdf', 'pdf/scan.pdf');
  await expect(pageButton(page, 1)).toBeVisible();
  const source = (await page.getByRole('button', { name: 'Drag page 1' }).boundingBox())!;
  const target = (await pageButton(page, 2).boundingBox())!;
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const end = { x: target.x + target.width * .8, y: target.y + target.height / 2 };
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
        { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 },
      ] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  }
  await expect(pageButton(page, 2)).toHaveAttribute('aria-pressed', 'true');
  if (isMobile) return;
  const tile = files(page).getByRole('button', { name: /^scan\.pdf/ });
  await expect(page.getByRole('progressbar', { name: 'Open progress' })).toBeHidden({ timeout: 15_000 });
  await expect(tile).toContainText('1 page', { timeout: 15_000 });
  await tile.scrollIntoViewIfNeeded();
  const handle = (await page.getByRole('button', { name: 'Drag page 2' }).boundingBox())!;
  const destination = (await tile.locator('.file-name').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(tile).toContainText('2 pages');
});

test('merges in Files order and extracts a range', async ({ page }) => {
  await open(page, 'pdf/mixed.pdf', 'pdf/scan.pdf');
  const scan = files(page).getByRole('button', { name: /^scan\.pdf/ });
  await expect(scan).toContainText('1 page');
  await scan.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await selectTool(page, 'Merge');
  await page.getByRole('button', { name: 'Merge PDFs', exact: true }).click();
  await expect(pageButton(page, 5)).toBeVisible();
  await selectTool(page, 'Split / extract');
  await page.getByLabel('Split method').selectOption('extract-ranges');
  await page.getByLabel('Page ranges').fill('1-2, 5');
  const result = await download(page, 'Export split or extract');
  expect(result.name).toBe('Merged-extracted.pdf');
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPages().map(item => item.getWidth())).toEqual([480, 300, 300]);
  await page.getByLabel('Split method').selectOption('each');
  const zip = await download(page, 'Export split or extract');
  expect(Object.keys(unzipSync(zip.bytes))).toHaveLength(5);
});

test('creates PDF pages from images and exports at the selected DPI', async ({ page }) => {
  await open(page, 'oriented.png', 'reference.heic');
  await expect(files(page).getByRole('button', { name: /^reference\.heic/ })).toContainText('1 page');
  await selectTool(page, 'Images to PDF');
  await page.getByLabel('Paper size').selectOption('letter');
  await page.getByLabel('Orientation').selectOption('landscape');
  await page.getByLabel('Margins (pt)').fill('24');
  await page.getByRole('button', { name: 'Apply image layout' }).click();
  const output = await download(page, 'Export PDF');
  const pdf = await PDFDocument.load(output.bytes);
  expect(pdf.getPages().map(item => item.getSize())).toEqual([{ width: 792, height: 612 }, { width: 792, height: 612 }]);
  await pageButton(page, 1).click();
  await selectTool(page, 'PDF to images');
  await page.getByLabel('Resolution (DPI)').selectOption('150');
  const png = await download(page, 'Export page images');
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
  expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual([1650, 1275]);
});

test('opens encrypted PDFs with a local password and reports corrupt inputs', async ({ page }) => {
  await open(page, 'pdf/encrypted.pdf');
  const dialog = page.getByRole('dialog', { name: 'Unlock PDF' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill('wrong');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Incorrect password');
  await dialog.getByLabel('Password', { exact: true }).fill('filekit-test');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('progressbar', { name: 'Open progress' })).toBeHidden();
  const output = await download(page, 'Export PDF');
  expect((await PDFDocument.load(output.bytes)).getPageCount()).toBe(1);
  await page.getByLabel('PDF and image files').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('damaged') });
  await expect(files(page).getByRole('alert')).toContainText('could not be opened');
});

test('requests only static same-origin assets when loading, unlocking and rasterizing PDFs', async ({ context, page, baseURL, browserName }) => {
  const origin = new URL(baseURL!).origin;
  const markers = ['encrypted.pdf', 'mixed.pdf', 'filekit-test', 'third page'];
  const violations = new Set<string>();
  const urls = new Set<string>();
  function check(request: Request) {
    const url = request.url();
    if (url.startsWith('blob:')) return false;
    urls.add(url);
    const parsed = new URL(url);
    const staticDownload = parsed.pathname === '/pdf/' || /^\/(?:_next\/|fonts\/|workers\/)/.test(parsed.pathname);
    const forbidden = parsed.origin !== origin || request.method() !== 'GET' || request.postDataBuffer() !== null ||
      !staticDownload || markers.some(marker => decodeURI(url).toLowerCase().includes(marker));
    if (forbidden) violations.add(url);
    return forbidden;
  }
  context.on('request', check);
  await context.route('**/*', route => check(route.request()) ? route.abort() : route.continue());
  await page.goto('/pdf/');
  await expect(page.getByRole('heading', { name: 'PDF', level: 1, exact: true })).toBeVisible();
  expect([...urls].filter(url => /\/workers\//.test(url))).toEqual([]);
  const picker = page.getByLabel('PDF and image files');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles([fixturePath('pdf/encrypted.pdf'), fixturePath('pdf/mixed.pdf')]);
  const dialog = page.getByRole('dialog', { name: 'Unlock PDF' });
  await dialog.getByLabel('Password', { exact: true }).fill('filekit-test');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await files(page).getByRole('button', { name: /^mixed\.pdf/ }).click();
  await expect(pageButton(page, 1)).toBeVisible();
  await selectTool(page, 'PDF to images');
  await page.getByLabel('Resolution (DPI)').selectOption('72');
  const image = await download(page, 'Export page images');
  expect([image.bytes.readUInt32BE(16), image.bytes.readUInt32BE(20)]).toEqual([300, 400]);
  const { data } = await sharp(image.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(data.some(channel => channel < 100)).toBe(true);
  if (browserName === 'chromium') {
    expect([...urls]).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/workers\/pdf\.worker\.js$/),
      expect.stringMatching(/\/workers\/pdf\/standard_fonts\/LiberationSans-Regular\.ttf$/),
      expect.stringMatching(/\/workers\/pdf\/qpdf\.wasm$/),
    ]));
  }
  expect([...violations]).toEqual([]);
});

test('virtualizes a 321-page PDF and keeps navigation responsive', async ({ page }) => {
  await open(page, 'pdf/large.pdf');
  await expect(page.getByLabel('Pages in document')).toBeVisible();
  expect(await page.locator('[data-pdf-page]').count()).toBeLessThan(45);
  await pageButton(page, 1).focus();
  await page.keyboard.press('End');
  await expect(pageButton(page, 321)).toBeFocused({ timeout: 2000 });
  expect(await page.locator('[data-pdf-page]').count()).toBeLessThan(45);
  await page.getByRole('button', { name: 'Select all pages' }).click();
  await expect(page.getByText('321 selected', { exact: true })).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`PDF workspace is accessible in ${colorScheme} mode`, async ({ page, isMobile }, info) => {
    // Match the existing desktop and touch axe sweep. Firefox 1572 can crash while axe reads ARIA labels.
    test.skip(!['desktop-chromium', 'android-chromium'].includes(info.project.name), 'Axe sweep on desktop and touch Chromium');
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await open(page, 'pdf/mixed.pdf');
    await expect(page.getByRole('region', { name: 'Preview' }).locator('img')).toHaveCount(4);
    await waitForFonts(page);
    const original = page.viewportSize()!;
    for (const width of isMobile ? [360] : [360, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: original.height });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize(original);
    const { violations } = await new AxeBuilder({ page }).setLegacyMode().analyze();
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
    const cover = files(page).getByRole('button', { name: /^mixed\.pdf/ });
    await cover.scrollIntoViewIfNeeded();
    await expect(cover.locator('img')).toBeVisible();
    await expect.poll(() => cover.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = `pdf-workspace-${colorScheme}.png`;
    const capture = { fullPage: true, animations: 'disabled', scale: 'device' } as const;
    await page.screenshot({ path: info.outputPath(screenshot), ...capture });
    if (process.platform === 'linux') {
      await expect(page).toHaveScreenshot(screenshot, { ...capture, maxDiffPixelRatio: .01 });
    }
  });
}
