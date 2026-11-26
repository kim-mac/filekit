import { expect, test, type Request } from '@playwright/test';
import { downloadResult, fileRow, fixtureBytes, pick, waitForImage } from './helpers';

test.use({ serviceWorkers: 'block' });

test('lazy codec, face detection, and upscale assets stay same origin and files never enter HTTP requests', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const fixtures = ['oriented.jpg', 'reference.heic', 'animated.gif', 'transparent.png', 'reference.webp', 'reference.avif', 'bg/person-urban.jpg'];
  const markers = [...fixtures.map((name) => name.split('/').at(-1)!), 'filekit-private-fixture-marker'];
  const bytes = await Promise.all(fixtures.map(fixtureBytes));
  for (const file of bytes) {
    markers.push(file.toString('hex'), file.toString('base64'), file.toString('base64url'));
    for (const start of [0, 32, Math.max(0, file.length - 24)]) {
      const sample = file.subarray(start, start + 16);
      markers.push(sample.toString('hex'), sample.toString('base64').replace(/=+$/, ''), sample.toString('base64url'));
    }
  }

  const violations = new Set<string>();
  const requests = new Set<string>();
  function inspect(request: Request) {
    const url = request.url();
    // Object URLs are references to browser memory and do not make HTTP requests.
    if (url.startsWith('blob:')) return false;
    requests.add(url);
    let decoded = url;
    try {
      for (let index = 0; index < 3 && decoded.includes('%'); index++) decoded = decodeURIComponent(decoded);
    } catch {
      // Still inspect the original URL if it contains invalid escapes.
    }
    const lower = decoded.toLowerCase();
    const blocked = new URL(url).origin !== origin ||
      request.method() !== 'GET' || request.postDataBuffer() !== null || markers.some((marker) => lower.includes(marker.toLowerCase()));
    if (blocked) violations.add(`${request.method()} ${url}`);
    return blocked;
  }

  context.on('request', inspect);
  await context.route('**/*', (route) => inspect(route.request()) ? route.abort() : route.continue());
  await page.goto('/');
  await page.getByRole('link', { name: /Images/ }).click();
  await expect(page.getByRole('heading', { name: 'Images', level: 1, exact: true })).toBeVisible();
  expect([...requests].filter((url) => /\/workers\/|\.wasm$/.test(url))).toEqual([]);

  await pick(page, ...fixtures);
  await waitForImage(page, 'oriented.jpg');
  await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeEnabled();
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByRole('button', { name: 'Flip horizontal' }).click();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeEnabled();
  expect((await downloadResult(page, 'Export ZIP')).bytes.length).toBeGreaterThan(0);
  const faceModel = /\/face-models\/yunet\.onnx$/;
  await fileRow(page, 'person-urban.jpg').getByRole('button', { name: /^person-urban\.jpg/ }).click();
  await page.getByRole('button', { name: 'Blur', exact: true }).click();
  await waitForImage(page, 'person-urban.jpg');
  expect([...requests].filter(url => faceModel.test(url))).toEqual([]);
  await page.getByRole('button', { name: 'Detect faces' }).click();
  await expect(page.getByText('1 face detected.', { exact: true })).toBeVisible({ timeout: 15_000 });

  const upscaleChunk = /\/upscale-models\/chunks\/[a-f0-9]{64}\/0\.bin$/;
  expect([...requests].filter(url => upscaleChunk.test(url))).toEqual([]);
  await fileRow(page, 'oriented.jpg').getByRole('button', { name: /^oriented\.jpg/ }).click();
  await page.getByRole('button', { name: 'Upscale', exact: true }).click();
  await page.getByRole('radio', { name: 'Art/Text', exact: true }).check();
  await page.getByRole('button', { name: 'Apply upscale' }).click();
  await expect(page.getByText(/Applied with Real-ESRGAN Anime/)).toBeVisible();
  expect((await downloadResult(page, 'Export image')).bytes.length).toBeGreaterThan(0);

  expect([...violations]).toEqual([]);
  expect([...requests]).toEqual(expect.arrayContaining([
    expect.stringMatching(/\/workers\/image\.worker\.js$/),
    expect.stringMatching(/\/workers\/mozjpeg_dec-.*\.wasm$/),
    expect.stringMatching(faceModel),
    expect.stringMatching(/\/fonts\/InterVariable\.woff2$/),
    expect.stringMatching(upscaleChunk),
    expect.stringMatching(/\/bg-runtime\/onnx\/ort-wasm-simd-threaded\.wasm$/),
  ]));
});
