import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const fixturePath = (name: string) => resolve(__dirname, '../fixtures', name);
export const fixtureBytes = (name: string) => readFile(fixturePath(name));
export const fileRow = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
export const formatChoice = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true });
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

export async function applyConversion(page: Page, format: string, quality?: number, background?: string) {
  await formatChoice(page, format).check();
  if (quality !== undefined) await page.getByRole('slider', { name: 'Quality' }).fill(String(quality));
  if (background) await page.getByRole('radio', { name: background, exact: true }).check();
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
