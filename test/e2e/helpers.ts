import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const fixturePath = (name: string) => resolve(__dirname, '../fixtures', name);
export const fixtureBytes = (name: string) => readFile(fixturePath(name));
export const fileRow = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
export const outputFormat = (page: Page) => page.getByRole('combobox', { name: 'Output format' });
export const toolTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
export const status = (page: Page) => page.locator('.job-status');
export const savedLink = (page: Page) => page.getByRole('link', { name: 'Save to device' });
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function openImageWorkspace(page: Page) {
  await page.goto('/images/');
  await expect(page.getByRole('heading', { name: 'Images', level: 1 })).toBeVisible();
}

export async function pick(page: Page, ...names: string[]) {
  await page.getByLabel('Image files').setInputFiles(names.map(fixturePath));
}

export async function sendFiles(page: Page, method: 'drop' | 'paste', names: string[]) {
  const payload = await Promise.all(names.map(async (name) => ({ name, bytes: [...await fixtureBytes(name)] })));
  await page.evaluate(({ method, payload }) => {
    const data = new DataTransfer();
    for (const { name, bytes } of payload) data.items.add(new File([new Uint8Array(bytes)], name));
    if (method === 'paste') {
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      // Firefox gives script-created ClipboardEvents an empty native clipboard.
      Object.defineProperty(event, 'clipboardData', { value: data });
      window.dispatchEvent(event);
    } else {
      document.querySelector('main')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    }
  }, { method, payload });
}

export async function waitForImage(page: Page, name: string) {
  await expect(page.getByRole('img', { name: `Preview of ${name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export image' })).toBeEnabled();
}

export async function selectFormat(page: Page, label: string) {
  await outputFormat(page).selectOption({ label: label === 'JPG' ? 'JPG (JPEG)' : label });
}

export async function setSlider(slider: Locator, value: number) {
  await expect(slider).toBeVisible();
  const [current, min, max] = await slider.evaluate(element =>
    ['aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map(attribute => Number(element.getAttribute(attribute))));
  await slider.focus();
  const keyboard = slider.page().keyboard;
  if (value === min || value === max) {
    await keyboard.press(value === min ? 'Home' : 'End');
    return;
  }
  const delta = value - current;
  const direction = delta > 0 ? 'Up' : 'Down';
  for (let i = 0; i < Math.floor(Math.abs(delta) / 10); i++) await keyboard.press(`Page${direction}`);
  for (let i = 0; i < Math.abs(delta) % 10; i++) await keyboard.press(`Arrow${direction}`);
  await expect(slider).toHaveAttribute('aria-valuenow', String(value));
}

export async function applyConversion(page: Page, format: string, quality?: number, fill?: string) {
  await selectFormat(page, format);
  if (quality !== undefined) await setSlider(page.getByRole('slider', { name: 'Quality' }), quality);
  if (fill) await page.getByRole('region', { name: 'Tools' }).getByLabel('Fill transparent areas with').fill(fill);
  await page.getByRole('button', { name: 'Apply convert' }).click();
  await expect(page.getByRole('button', { name: 'Export image' })).toBeEnabled();
}

export async function downloadResult(page: Page, action: 'Export image' | 'Export ZIP') {
  await page.getByRole('button', { name: action }).click();
  await expect(savedLink(page)).toBeVisible({ timeout: 25_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), savedLink(page).click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path!) };
}

export async function waitForFonts(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}

export async function observeModelCalls(page: Page, method: 'findFaces' | 'makeMask') {
  await page.addInitScript(name => {
    const state = window as Window & { filekitTestModelCalls?: number };
    state.filekitTestModelCalls = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options) {
      if (message?.type === 'APPLY' && message.path?.[0] === name) state.filekitTestModelCalls = (state.filekitTestModelCalls ?? 0) + 1;
      return Reflect.apply(send, this, [message, options ?? {}]);
    };
  }, method);
  return () => page.evaluate(() => (window as Window & { filekitTestModelCalls?: number }).filekitTestModelCalls);
}

export async function waitForEstimates(page: Page) {
  for (const output of await page.locator('.output-estimate strong').all()) {
    await expect(output).toHaveText(/^≈ /, { timeout: 20_000 });
  }
}

export async function holdRequest(context: BrowserContext, match: RegExp) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route(match, async route => {
    await gate;
    await route.continue().catch(() => undefined);
  }, { times: 1 });
  return async () => { release(); };
}

export async function countDownloadNotices(page: Page) {
  await page.addInitScript(() => {
    let count = 0;
    new MutationObserver(records => {
      count += records.flatMap(record => [...record.addedNodes]).filter((node): node is Element =>
        node instanceof Element && /One-time model download/.test(node.textContent ?? ''),
      ).filter(node => node.matches('.notice') || Boolean(node.querySelector('.notice'))).length;
      document.documentElement.dataset.downloadNotices = String(count);
    }).observe(document, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => Number(document.documentElement.dataset.downloadNotices ?? 0));
}
