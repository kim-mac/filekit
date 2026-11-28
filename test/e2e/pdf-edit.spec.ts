import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fixturePath, waitForFonts } from './helpers';

test.describe.configure({ timeout: 120_000 });
const objectList = (page: Page) => page.getByRole('combobox', { name: 'Page objects', exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const choose = (page: Page, name: string) => button(page, name).click();
const surface = (page: Page) => page.locator('.pdf-edit-layer');

async function open(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/pdf/');
  const input = page.getByLabel('PDF and image files');
  await expect(input).toBeEnabled();
  await input.setInputFiles(file);
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(surface(page)).toBeVisible({ timeout: 15_000 });
}

async function gesture(page: Page, target: Locator, points: [number, number][], mobile: boolean, browser: string) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const coordinates = points.map(([x, y]) => ({ x: box.x + box.width * x, y: box.y + box.height * y }));
  if (mobile && browser === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const [index, point] of coordinates.entries()) {
        await cdp.send('Input.dispatchTouchEvent', { type: index ? 'touchMove' : 'touchStart', touchPoints: [point] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
  } else if (mobile) {
    for (const [index, point] of coordinates.entries()) {
      await target.dispatchEvent(index ? 'pointermove' : 'pointerdown', {
        pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: point.x, clientY: point.y, bubbles: true,
      });
    }
    const point = coordinates.at(-1)!;
    await target.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: point.x, clientY: point.y, bubbles: true });
    if (points.length === 1) await target.dispatchEvent('click', { button: 0, clientX: point.x, clientY: point.y, bubbles: true });
  } else {
    await page.mouse.move(coordinates[0].x, coordinates[0].y);
    await page.mouse.down();
    for (const point of coordinates.slice(1)) await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.mouse.up();
  }
}

async function exportPdf(page: Page) {
  await choose(page, 'Export PDF');
  const link = page.getByRole('link', { name: 'Save to device' });
  await expect(link).toBeVisible({ timeout: 45_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return new Uint8Array(await readFile((await download.path())!));
}

async function inspect(bytes: Uint8Array) {
  const doc = getDocument({ data: bytes.slice(), useSystemFonts: true });
  try {
    const pdf = await doc.promise;
    return await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const items = (await page.getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []);
      const annotations = await page.getAnnotations();
      return { text: items.join(' '), annotations };
    }));
  } finally {
    await doc.destroy();
  }
}

test('edits and exports text, signatures, marks, shapes and image stamps', async ({ page, isMobile, browserName, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const violations = new Set<string>();
  const verify = (request: Request) => {
    if (request.url().startsWith('blob:')) return;
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET' || request.postDataBuffer() ||
      /mixed\.pdf|Private%20note|transparent\.png/i.test(url.pathname + url.search)) violations.add(url.href);
  };
  context.on('request', verify);
  await open(page, fixturePath('pdf/mixed.pdf'));
  await button(page, 'Zoom in').click();
  await choose(page, 'Add text');
  const canvas = surface(page);
  await gesture(page, canvas, [[.34, .34]], isMobile, browserName);
  const text = page.getByLabel('Text', { exact: true });
  await expect(text).toBeFocused();
  await text.fill('Private note');
  await text.blur();
  await page.getByLabel('Bold', { exact: true }).check();
  const x = page.getByLabel('X (pt)', { exact: true });
  const initial = Number(await x.inputValue());
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(x).toHaveValue(String(Math.round((initial + 10) * 10) / 10));
  await page.keyboard.press('ControlOrMeta+z');
  await expect(x).toHaveValue(String(initial));
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(x).toHaveValue(String(Math.round((initial + 10) * 10) / 10));
  await page.keyboard.press('Escape');
  await expect(x).toHaveCount(0);
  await objectList(page).selectOption({ label: '1. Private note' });
  await choose(page, 'Duplicate object');
  await expect(objectList(page).locator('option')).toHaveCount(3);
  await canvas.focus();
  await page.keyboard.press('Delete');
  await expect(objectList(page).locator('option')).toHaveCount(2);
  await choose(page, 'Fit');

  await choose(page, 'Signature');
  await gesture(page, page.getByLabel('Signature drawing pad'), [[.15, .75], [.3, .25], [.4, .62], [.72, .45]], isMobile, browserName);
  await choose(page, 'Use signature');
  await gesture(page, canvas, [[.20, .40]], isMobile, browserName);
  await choose(page, 'Signature');
  await page.getByLabel('Signature method').selectOption('type');
  await page.getByLabel('Signature text', { exact: true }).fill('Jane Tester');
  await page.getByLabel('Script font').selectOption('vibes');
  await choose(page, 'Save signature');
  await expect(page.getByText('Saved only in this browser.')).toBeVisible();
  await choose(page, 'Use saved signature 1');
  await choose(page, 'Place on page');
  await choose(page, 'Signature');
  await expect(button(page, 'Use saved signature 1')).toBeVisible();
  await choose(page, 'Delete saved signature 1');
  await expect(button(page, 'Use saved signature 1')).toHaveCount(0);

  await choose(page, 'Highlight');
  await gesture(page, canvas, [[.11, .09], [.50, .15]], isMobile, browserName);
  await choose(page, 'Rectangle');
  await gesture(page, canvas, [[.22, .70], [.57, .79]], isMobile, browserName);
  await choose(page, 'Arrow');
  await gesture(page, canvas, [[.52, .79], [.73, .88]], isMobile, browserName);
  await choose(page, 'Image / stamp');
  await page.getByLabel('Stamp image').setInputFiles(fixturePath('transparent.png'));
  await expect(button(page, 'Place on page')).toBeVisible();
  await gesture(page, canvas, [[.60, .40]], isMobile, browserName);
  await choose(page, 'Whiteout');
  await expect(page.getByText(/Whiteout is a visual cover only. It is not secure/)).toBeVisible();
  await gesture(page, canvas, [[.12, .88], [.25, .95]], isMobile, browserName);

  await expect(page.getByLabel('PDF annotations')).toHaveValue('flatten');
  await page.getByLabel('PDF annotations').selectOption('editable');
  const bytes = await exportPdf(page);
  const [first] = await inspect(bytes);
  expect(first.text).toContain('Private note');
  expect(first.text).toContain('Jane Tester');
  expect(first.text).toContain('First page');
  expect(first.annotations).toEqual(expect.arrayContaining([expect.objectContaining({ subtype: 'Highlight' })]));
  expect([...violations]).toEqual([]);
});

test('fills on-page AcroForm fields and downloads them with and without flattening', async ({ page }) => {
  const doc = await PDFDocument.create();
  const paper = doc.addPage([300, 390]);
  const fields = doc.getForm();
  fields.createTextField('Name').addToPage(paper, { x: 54, y: 300, width: 150, height: 24 });
  fields.createCheckBox('Yes').addToPage(paper, { x: 54, y: 250, width: 26, height: 26 });
  const radio = fields.createRadioGroup('Direction');
  radio.addOptionToPage('North', paper, { x: 54, y: 200, width: 26, height: 26 });
  radio.addOptionToPage('South', paper, { x: 54, y: 153, width: 26, height: 26 });
  const dropdown = fields.createDropdown('Level');
  dropdown.addOptions(['One', 'Two']);
  dropdown.addToPage(paper, { x: 54, y: 100, width: 150, height: 26 });
  await open(page, { name: 'fields.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await choose(page, 'Fill forms');
  const input = page.getByRole('textbox', { name: 'On page: Name', exact: true });
  await input.fill('On-device form');
  await input.blur();
  await page.getByRole('checkbox', { name: 'On page: Yes' }).check();
  await page.getByRole('radio', { name: 'On page: Direction, South' }).check();
  await page.getByRole('combobox', { name: 'On page: Level' }).selectOption('Two');
  const interactive = (await PDFDocument.load(await exportPdf(page))).getForm();
  expect(interactive.getTextField('Name').getText()).toBe('On-device form');
  expect(interactive.getCheckBox('Yes').isChecked()).toBe(true);
  expect(interactive.getRadioGroup('Direction').getSelected()).toBe('South');
  expect(interactive.getDropdown('Level').getSelected()).toEqual(['Two']);
  await page.getByLabel('Make fields non-editable').check();
  const bytes = await exportPdf(page);
  expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
  expect((await inspect(bytes))[0].text).toContain('On-device form');
});

test('burns redactions into the pixels and removes hidden PDF copies', async ({ page, isMobile, browserName }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const secret = 'FILEKIT-DISTINCT-SECRET';
  const [first, second] = [doc.addPage([300, 400]), doc.addPage([300, 400])];
  first.drawText(secret, { x: 42, y: 313, font, size: 16 });
  first.drawRectangle({ x: 43, y: 292, width: 48, height: 16, color: rgb(1, 0, 0) });
  second.drawText('Unedited text stays selectable', { x: 36, y: 315, font, size: 14 });
  doc.setTitle(secret);
  await doc.attach(new TextEncoder().encode(secret), 'hidden-original.txt', { mimeType: 'text/plain' });
  const marker = doc.context.register(doc.context.flateStream(`% ${secret}\n`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
  const metadata = doc.context.register(doc.context.flateStream(secret, { Type: 'Metadata', Subtype: 'XML' }));
  const used = doc.context.register(doc.context.flateStream('0 0 4 4 re f', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Metadata: metadata,
  }));
  const resources = second.node.Resources()!;
  resources.set(PDFName.of('XObject'), doc.context.obj({ Hidden: marker, Keep: used }));
  second.node.addContentStream(doc.context.register(doc.context.flateStream('/Keep Do')));
  await open(page, { name: 'security.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save({ useObjectStreams: false })) });
  await page.getByRole('tab', { name: 'Organize', exact: true }).click();
  await choose(page, 'Duplicate');
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await choose(page, 'Redact');
  await gesture(page, surface(page), [[.11, .16], [.85, .28]], isMobile, browserName);
  await choose(page, 'Export PDF');
  await expect(page.getByRole('region', { name: 'Export' }).getByRole('alert')).toContainText('Apply or remove the marked redactions');
  await choose(page, 'Apply redactions');
  const confirm = page.getByRole('dialog', { name: 'Apply redactions?' });
  await expect(confirm).toContainText("Redacted pages are converted to images; text on those pages won't be selectable.");
  await confirm.getByRole('button', { name: 'Confirm redactions' }).click();
  const bytes = await exportPdf(page);
  const pages = await inspect(bytes);
  expect(pages[0].text).toBe('');
  expect(pages[1].text).toBe('');
  expect(pages[2].text).toContain('Unedited text stays selectable');
  const output = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(output.catalog.has(PDFName.of('Names'))).toBe(false);
  expect(output.getTitle()).toBeUndefined();
  for (const [, object] of output.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) {
      const stream = new TextDecoder().decode(decodePDFRawStream(object).decode());
      expect(stream).not.toContain(secret);
    }
  }
  const images = output.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  const raster = images?.entries().map(([, ref]) => output.context.lookup(ref)).find(object => object instanceof PDFRawStream);
  expect(raster).toBeInstanceOf(PDFRawStream);
  const image = raster as PDFRawStream;
  const raw = decodePDFRawStream(image).decode();
  const width = image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber();
  const height = image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber();
  const pixel = (Math.floor(height * .245) * width + Math.floor(width * .20)) * 3;
  expect([...raw.subarray(pixel, pixel + 3)]).toEqual([0, 0, 0]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`PDF editor is accessible in ${colorScheme} mode`, async ({ page }, info) => {
    test.skip(!['desktop-chromium', 'android-chromium'].includes(info.project.name), 'Desktop and mobile Chromium screenshots');
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await open(page, fixturePath('pdf/mixed.pdf'));
    await choose(page, 'Add text');
    await choose(page, 'Place on page');
    await page.getByLabel('Text', { exact: true }).fill('Reviewed on this device');
    await page.getByLabel('Text', { exact: true }).blur();
    for (const [name, value] of [['X (pt)', '38'], ['Y (pt)', '120']]) {
      const position = page.getByRole('spinbutton', { name, exact: true });
      await position.fill(value);
      await position.press('Enter');
    }
    await waitForFonts(page);
    const original = page.viewportSize()!;
    for (const width of info.project.name === 'android-chromium' ? [360] : [360, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: original.height });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize(original);
    const { violations } = await new AxeBuilder({ page }).setLegacyMode().analyze();
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
    const cover = page.getByRole('region', { name: 'Files' }).getByRole('button', { name: /^mixed\.pdf/ }).locator('img');
    await cover.scrollIntoViewIfNeeded();
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = `pdf-edit-${colorScheme}.png`;
    const capture = { fullPage: true, animations: 'disabled', scale: 'device' } as const;
    await page.screenshot({ path: info.outputPath(screenshot), ...capture });
    if (process.platform === 'linux') await expect(page).toHaveScreenshot(screenshot, { ...capture, maxDiffPixelRatio: .015 });
  });
}
