import { expect, test, type Request } from '@playwright/test';
import { downloadResult, fixtureBytes, pick, waitForImage } from './helpers';

test.use({ serviceWorkers: 'block' });

test('lazy codec assets stay same origin and files never enter HTTP requests', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const fixtures = ['oriented.jpg', 'reference.heic', 'animated.gif', 'transparent.png', 'reference.webp', 'reference.avif'];
  const markers = [...fixtures, 'filekit-private-fixture-marker'];
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
      request.postDataBuffer() !== null || markers.some((marker) => lower.includes(marker.toLowerCase()));
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
  expect((await downloadResult(page, 'Export ZIP')).bytes.length).toBeGreaterThan(0);
  expect([...violations]).toEqual([]);
  expect([...requests]).toEqual(expect.arrayContaining([
    expect.stringMatching(/\/workers\/image\.worker\.js$/),
    expect.stringMatching(/\/workers\/mozjpeg_dec-.*\.wasm$/),
  ]));
});
