import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { applyConversion, downloadResult, openImageWorkspace, pick, waitForImage } from './helpers';

async function dragCorner(page: Page, corner: Locator, isMobile: boolean, browserName: string) {
  await corner.scrollIntoViewIfNeeded();
  const box = (await corner.boundingBox())!;
  const from = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const to = { x: from.x - 32, y: from.y - 28 };
  if (!isMobile) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  } else if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    // Playwright's WebKit touchscreen sends native taps. Replay a pointer
    // sequence to cover the drag path because the API only exposes tap.
    await corner.evaluate((element: HTMLElement, { from, to }) => {
      const capture = element.setPointerCapture;
      element.setPointerCapture = () => {};
      try {
        for (const [type, point] of [['pointerdown', from], ['pointermove', to], ['lostpointercapture', to]] as const) {
          element.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientX: point.x, clientY: point.y,
          }));
        }
      } finally {
        element.setPointerCapture = capture;
      }
    }, { from, to });
  }
}

test('crops, rotates, flips, and replays edits using each device’s controls', async ({ page, isMobile, browserName }) => {
  const action = (control: Locator) => isMobile ? control.tap() : control.click();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const cropBox = page.getByRole('group', { name: 'Crop box' });
  const draftSize = page.getByLabel('Crop size');
  const actualSize = page.locator('.preview-footer > span');

  await openImageWorkspace(page);
  await pick(page, 'oriented.png');
  await waitForImage(page, 'oriented.png');
  await applyConversion(page, 'JPG', 70);
  await action(button('Crop'));
  await expect(cropBox).toBeVisible();

  for (const [preset, dimensions] of [['1:1', '64 × 64'], ['4:5', '64 × 80'], ['16:9', '64 × 36'], ['9:16', '54 × 96']]) {
    await action(page.getByRole('radio', { name: preset, exact: true }));
    await expect(draftSize).toHaveText(`${dimensions} px`);
  }
  await action(page.getByRole('radio', { name: '4:5', exact: true }));
  await expect(draftSize).toHaveText('64 × 80 px');
  if (isMobile) {
    await action(button('Rotate right'));
    await expect(draftSize).toHaveText('80 × 64 px');
    await action(button('Rotate left'));
    await expect(draftSize).toHaveText('64 × 80 px');
    await action(button('Rotate right'));
    await action(button('Flip horizontal'));
    await action(button('Flip vertical'));
  } else {
    const before = (await cropBox.boundingBox())!.y;
    await cropBox.press('ArrowDown');
    expect((await cropBox.boundingBox())!.y).toBeGreaterThan(before);
    await cropBox.press('r');
    await expect(draftSize).toHaveText('80 × 64 px');
    await cropBox.press('Shift+r');
    await expect(draftSize).toHaveText('64 × 80 px');
    await cropBox.press('r');
    await cropBox.press('h');
    await cropBox.press('v');
  }

  await action(button('Apply crop'));
  await expect(actualSize).toHaveText('80 × 64 px');
  await expect(page.getByText('JPG · Quality 70%')).toBeVisible();
  await expect(button('Undo')).toBeEnabled();
  if (isMobile) await action(button('Undo'));
  else await page.keyboard.press('ControlOrMeta+z');
  await expect(actualSize).toHaveText('64 × 96 px');
  await expect(button('Redo')).toBeEnabled();
  if (isMobile) await action(button('Redo'));
  else await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(actualSize).toHaveText('80 × 64 px');

  await action(button('Convert'));
  await applyConversion(page, 'PNG');
  const { name, bytes } = await downloadResult(page, 'Export image');
  expect(name).toBe('oriented.png');
  const image = sharp(bytes);
  const metadata = await image.metadata();
  expect(metadata).toMatchObject({ width: 80, height: 64, format: 'png' });
  expect(metadata.exif).toBeUndefined();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const index = (y * info.width + x) * info.channels;
    return [...data.subarray(index, index + 3)];
  };
  expect(pixel(0, 0)).toEqual([230, 65, 46]);
  expect(pixel(79, 0)).toEqual([38, 170, 80]);
  expect(pixel(0, 63)).toEqual([39, 107, 214]);
  expect(pixel(79, 63)).toEqual([255, 214, 60]);

  await action(button('Crop'));
  await expect(page.getByRole('radio', { name: 'Free', exact: true })).toBeChecked();
  await expect(draftSize).toHaveText('80 × 64 px');
  await dragCorner(page, button('Resize crop from bottom right'), isMobile, browserName);
  await expect(draftSize).not.toHaveText('80 × 64 px');
});
