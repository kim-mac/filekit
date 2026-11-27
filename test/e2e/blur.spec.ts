import { expect, test, type Locator, type Page } from '@playwright/test';
import { performance as timer } from 'node:perf_hooks';
import sharp from 'sharp';
import { countDownloadNotices, holdRequest, downloadResult, observeModelCalls, openImageWorkspace, pick, savedLink, waitForFonts, waitForImage, toolTab, setSlider } from './helpers';

type Point = { x: number; y: number };
type Input = { page: Page; editor: Locator; isMobile: boolean; browserName: string };

function midpoint(rect: { x: number; y: number; width: number; height: number }, x = 0.5, y = 0.5): Point {
  return { x: Math.round(rect.x + rect.width * x), y: Math.round(rect.y + rect.height * y) };
}

async function pointerDrag({ page, editor, isMobile, browserName }: Input, from: Point[], to: Point[]) {
  if (!isMobile) {
    await page.mouse.move(from[0].x, from[0].y);
    await page.mouse.down();
    await page.mouse.move(to[0].x, to[0].y, { steps: 5 });
    await page.mouse.up();
  } else if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    try {
      if (from.length === 1) {
        // The compositor handles this as a native touch gesture and resets
        // its tap suppression before the next control interaction.
        const x = to[0].x - from[0].x;
        const y = to[0].y - from[0].y;
        await session.send('Input.synthesizeScrollGesture', {
          ...from[0], xDistance: x, yDistance: y, speed: 440, gestureSourceType: 'touch', preventFling: true,
        });
      } else {
        const touch = (points: Point[]) => points.map((point, id) => ({ ...point, id }));
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from) });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(to) });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    } finally {
      await session.detach();
    }
  } else {
    // Playwright exposes native WebKit taps but no touch drag or pinch API.
    await editor.evaluate((surface: HTMLElement, { from, to }) => {
      const capture = surface.setPointerCapture;
      surface.setPointerCapture = () => {};
      try {
        for (const [type, points] of [['pointerdown', from], ['pointermove', to], ['pointerup', to]] as const) {
          for (const [id, point] of points.entries()) {
            const target = type === 'pointerdown' ? document.elementFromPoint(point.x, point.y) : surface;
            target?.dispatchEvent(new PointerEvent(type, {
              bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id + 1,
              clientX: point.x, clientY: point.y,
            }));
          }
        }
      } finally {
        surface.setPointerCapture = capture;
      }
    }, { from, to });
  }
}

test('draws, erases, moves, resizes, deletes, and replays blur regions', async ({ page, isMobile, browserName }) => {
  const action = (control: Locator) => isMobile ? control.tap() : control.click();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const editor = page.getByRole('group', { name: 'Blur editor' });
  const frame = editor.locator('.blur-frame');
  const preview = page.locator('.preview-image');
  const input = { page, editor, isMobile, browserName };
  async function draw(from: [number, number], to: [number, number]) {
    await editor.scrollIntoViewIfNeeded();
    const box = (await frame.boundingBox())!;
    await pointerDrag(input, [midpoint(box, ...from)], [midpoint(box, ...to)]);
  }

  await openImageWorkspace(page);
  await pick(page, 'oriented.png');
  await waitForImage(page, 'oriented.png');
  const original = await preview.getAttribute('src');
  await action(toolTab(page, 'Blur'));
  await expect(editor).toBeVisible();
  if (!isMobile) {
    await editor.press(']');
    await expect(page.getByRole('slider', { name: 'Brush size' })).toHaveAttribute('aria-valuenow', '13');
    await editor.press('[');
    await expect(page.getByRole('slider', { name: 'Brush size' })).toHaveAttribute('aria-valuenow', '12');
  }
  await draw([0.15, 0.26], [0.78, 0.26]);
  await expect(editor.locator('canvas')).toBeVisible();
  await action(button('Eraser'));
  await expect(button('Eraser')).toHaveAttribute('aria-pressed', 'true');
  await draw([0.45, 0.26], [0.56, 0.26]);

  await action(button('Rectangle'));
  await expect(button('Rectangle')).toHaveAttribute('aria-pressed', 'true');
  await draw([0.18, 0.4], [0.58, 0.68]);
  const rectangle = page.getByRole('group', { name: 'Blur rectangle 3' });
  await expect(rectangle).toBeVisible();
  const rectBefore = (await rectangle.boundingBox())!;
  await draw([0.38, 0.54], [0.45, 0.6]);
  const rectMoved = (await rectangle.boundingBox())!;
  expect(rectMoved.x).toBeGreaterThan(rectBefore.x + 5);
  await expect(button('Delete shape')).toBeVisible();

  const resize = button('Resize shape from bottom right');
  await resize.scrollIntoViewIfNeeded();
  const handle = midpoint((await resize.boundingBox())!);
  await pointerDrag(input, [handle], [{ x: handle.x + 13, y: handle.y + 12 }]);
  expect((await rectangle.boundingBox())!.width).toBeGreaterThan(rectMoved.width + 5);

  await action(button('Ellipse'));
  await expect(button('Ellipse')).toHaveAttribute('aria-pressed', 'true');
  await draw([0.13, 0.72], [0.43, 0.94]);
  const ellipse = page.getByRole('group', { name: 'Blur ellipse 4' });
  await expect(ellipse).toBeVisible();
  if (isMobile) {
    await ellipse.tap();
    await action(button('Delete shape'));
  } else {
    await ellipse.press('Delete');
  }
  await expect(ellipse).toHaveCount(0);
  await expect(rectangle).toBeVisible();

  await action(page.getByRole('radio', { name: 'Pixelate', exact: true }));
  await setSlider(page.getByRole('slider', { name: 'Block size' }), 75);
  await action(page.getByRole('checkbox', { name: 'Invert selected regions' }));
  await action(button('Apply blur'));
  await expect(preview).not.toHaveAttribute('src', original!);
  await expect(button('Undo')).toBeEnabled();
  if (isMobile) await action(button('Undo'));
  else await page.keyboard.press('ControlOrMeta+z');
  await expect(button('Redo')).toBeEnabled();
  if (isMobile) await action(button('Redo'));
  else await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(button('Export image')).toBeEnabled();
  const { bytes } = await downloadResult(page, 'Export image');
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 64, height: 96, format: 'png' });

  if (isMobile) {
    await action(button('Brush'));
    await editor.scrollIntoViewIfNeeded();
    const box = (await frame.boundingBox())!;
    await pointerDrag(input,
      [midpoint(box, 0.38, 0.4), midpoint(box, 0.62, 0.6)],
      [midpoint(box, 0.3, 0.31), midpoint(box, 0.8, 0.76)],
    );
    await expect.poll(async () => Number(await page.locator('.preview-stage').getAttribute('data-zoom'))).toBeGreaterThan(1.2);
    await expect(editor.locator('canvas')).toHaveCount(0);
  }
});

test('adds adjustable regions with the local face detector', async ({ page, isMobile }, testInfo) => {
  const calls = await observeModelCalls(page, 'findFaces');
  const verifyNotice = testInfo.project.name === 'desktop-chromium';
  const noticeCount = verifyNotice ? await countDownloadNotices(page) : undefined;
  const action = (control: Locator) => isMobile ? control.tap() : control.click();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await openImageWorkspace(page);
  await pick(page, 'bg/person-urban.jpg');
  await waitForImage(page, 'person-urban.jpg');
  await action(toolTab(page, 'Blur'));
  const gate = verifyNotice ? await holdRequest(page.context(), /\/face-models\/yunet\.onnx$/) : undefined;
  try {
    await action(button('Detect faces'));
    if (gate) {
      await expect(page.getByText(/One-time model download \(~0\.34 MB\)/)).toBeVisible();
      await expect(page.getByRole('progressbar', { name: 'Model download progress' })).toBeVisible();
    }
  } finally {
    await gate?.();
  }
  await expect(page.getByText('1 face detected.', { exact: true })).toBeVisible({ timeout: 15_000 });
  const face = page.getByRole('group', { name: 'Blur rectangle 1' });
  await expect(face).toBeVisible();
  await expect(button('Resize shape from bottom right')).toBeVisible();
  const preview = page.getByRole('region', { name: 'Preview' });
  const controls = page.getByRole('region', { name: 'Tools' });
  await expect(preview.locator('canvas')).toBeVisible();
  if (['desktop-chromium', 'android-chromium'].includes(testInfo.project.name)) {
    await waitForFonts(page);
    await expect(preview).toHaveScreenshot('blur.png', { animations: 'disabled', maxDiffPixelRatio: 0.04 });
    await expect(controls).toHaveScreenshot('blur-controls.png', { animations: 'disabled', maxDiffPixelRatio: 0.04 });
  }
  await action(button('Delete shape'));
  await expect(face).toHaveCount(0);
  await action(button('Detect faces'));
  await expect(face).toBeVisible();
  await action(button('Apply blur'));
  await expect(button('Undo')).toBeEnabled();
  expect(await calls()).toBe(1);
  expect((await downloadResult(page, 'Export image')).bytes.length).toBeGreaterThan(0);
  expect(await calls()).toBe(1);
  if (noticeCount) expect(await noticeCount()).toBe(1);
});

test('times a full-image 6000×4000 Gaussian export at maximum strength', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const fixture = 'large-6000x4000.jpg';
  await openImageWorkspace(page);
  await pick(page, fixture);
  await waitForImage(page, fixture);
  await toolTab(page, 'Blur').click();
  await setSlider(page.getByRole('slider', { name: 'Strength' }), 100);
  await page.getByRole('checkbox', { name: 'Invert selected regions' }).check();
  const previewStart = timer.now();
  await page.getByRole('button', { name: 'Apply blur' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  const previewMs = Math.round(timer.now() - previewStart);

  const start = timer.now();
  await page.getByRole('button', { name: 'Export image' }).click();
  const uiFrameMs = await page.evaluate(() => {
    const before = performance.now();
    return new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now() - before)));
  });
  await expect(savedLink(page)).toBeVisible({ timeout: 25_000 });
  const exportMs = Math.round(timer.now() - start);
  const [download] = await Promise.all([page.waitForEvent('download'), savedLink(page).click()]);
  expect(await sharp((await download.path())!).metadata()).toMatchObject({ width: 6000, height: 4000, format: 'jpeg' });
  const timing = { project: testInfo.project.name, dimensions: '6000x4000', previewMs, exportMs, uiFrameMs: Math.round(uiFrameMs) };
  console.log(`FileKit blur timing ${JSON.stringify(timing)}`);
  await testInfo.attach('blur-timing', { body: JSON.stringify(timing), contentType: 'application/json' });
  expect(uiFrameMs).toBeLessThan(1_500);
});
