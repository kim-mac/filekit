import { expect, test, type Locator } from '@playwright/test';
import { openImageWorkspace, pick, waitForEstimates, waitForFonts, waitForImage } from './helpers';

async function edges(element: Locator) {
  return element.evaluate(node => {
    const { left, right } = node.getBoundingClientRect();
    return { left, right };
  });
}

for (const width of [1280, 1440]) {
  test(`aligns the floating navbar with home and workspace cards at ${width}px`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop card alignment');
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    const header = page.getByRole('banner');
    const home = await edges(header);
    const cards = page.getByRole('region', { name: 'Tool categories' });
    const first = await edges(cards.getByRole('link', { name: /^Images/ }));
    const last = await edges(cards.locator('.category-card').filter({ has: page.getByRole('heading', { name: 'Video' }) }));
    expect(Math.abs(home.left - first.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(home.right - last.right)).toBeLessThanOrEqual(1);

    await cards.getByRole('link', { name: /^Images/ }).click();
    await expect(page).toHaveURL('/images/');
    const workspace = await edges(header);
    const preview = await edges(page.getByRole('region', { name: 'Preview' }));
    const tools = await edges(page.getByRole('region', { name: 'Tools' }));
    expect(Math.abs(workspace.left - preview.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(workspace.right - tools.right)).toBeLessThanOrEqual(1);
    expect(workspace).toEqual(home);
  });
}

test('keeps the navbar in place as content scrolls underneath', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 540 });
  await openImageWorkspace(page);
  await pick(page, 'oriented.png', 'transparent.png');
  await waitForImage(page, 'oriented.png');
  await waitForFonts(page);

  const header = page.getByRole('banner');
  const preview = page.getByRole('region', { name: 'Preview' });
  const initialHeader = (await header.boundingBox())!;
  const initialPreview = (await preview.boundingBox())!;
  expect(initialHeader.y).toBeGreaterThan(0);
  await expect(header).not.toHaveAttribute('data-scrolled');
  const scrollY = await page.evaluate(() => {
    window.scrollTo(0, 180);
    return window.scrollY;
  });
  expect(scrollY).toBeGreaterThan(0);
  await expect(header).toHaveAttribute('data-scrolled', 'true');
  expect((await header.boundingBox())!.y).toBeCloseTo(initialHeader.y, 0);
  expect((await preview.boundingBox())!.y + scrollY).toBeCloseTo(initialPreview.y, 0);
});

test('the desktop switcher marks Images and keeps upcoming categories disabled', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Inline navigation is desktop-only');
  await openImageWorkspace(page);
  const nav = page.getByRole('navigation', { name: 'Tool categories' });
  const images = nav.getByRole('link', { name: 'Images' });
  await expect(images).toHaveAttribute('aria-current', 'page');
  for (const category of ['PDF', 'Audio', 'Video']) {
    await expect(nav.getByRole('button', { name: `${category} Soon` })).toBeDisabled();
  }
  await images.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/images/');
  await page.getByRole('link', { name: 'FileKit home' }).click();
  await expect(page).toHaveURL('/');
});

test('the mobile dropdown fits the logo and privacy badge and supports keyboard navigation', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 441, height: 780 });
  await openImageWorkspace(page);
  const header = page.getByRole('banner');
  await waitForFonts(page);
  expect(await header.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(header.getByRole('link', { name: 'FileKit home' })).toBeInViewport();
  const privacy = header.getByRole('button', { name: 'Files stay on this device' });
  await expect(privacy).toBeInViewport();
  expect((await privacy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (isMobile) {
    await privacy.tap();
    await expect(page.getByRole('dialog', { name: 'File privacy' })).toHaveText('Files stay on this device');
    await page.keyboard.press('Escape');
    await expect(privacy).toBeFocused();
  }
  const trigger = header.getByRole('button', { name: /Switch category/ });
  await expect(trigger).toBeInViewport();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: /Switch category/ });
  await expect(menu).toBeVisible();
  const images = menu.getByRole('menuitem', { name: 'Images' });
  await expect(images).toHaveAttribute('aria-current', 'page');
  for (const category of ['PDF', 'Audio', 'Video']) {
    await expect(menu.getByRole('menuitem', { name: `${category} Soon` })).toBeDisabled();
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(images).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL('/images/');
});

test('captures the dark navbar at desktop and mobile sizes', async ({ page, isMobile }, info) => {
  test.skip(!['desktop-chromium', 'android-chromium'].includes(info.project.name), 'Chromium screenshot baselines');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFonts(page);
  await expect(page).toHaveScreenshot('home-dark.png', { fullPage: true, maxDiffPixelRatio: 0.04 });

  await openImageWorkspace(page);
  await pick(page, 'bg/portrait-wind.jpg', 'bg/vase-white.jpg');
  await waitForImage(page, 'portrait-wind.jpg');
  await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeEnabled();
  await waitForFonts(page);
  await waitForEstimates(page);
  await expect(page).toHaveScreenshot('workspace-navbar-dark.png', { maxDiffPixelRatio: 0.04 });
  if (isMobile) {
    await page.getByRole('button', { name: /Switch category/ }).click();
    await expect(page.getByRole('menu', { name: /Switch category/ })).toBeVisible();
    await expect(page).toHaveScreenshot('navbar-dropdown-dark.png', { maxDiffPixelRatio: 0.04 });
  } else {
    await page.setViewportSize({ width: 1280, height: 540 });
    await page.evaluate(() => window.scrollTo(0, 180));
    await expect(page.getByRole('banner')).toHaveAttribute('data-scrolled', 'true');
    await expect(page).toHaveScreenshot('navbar-sticky-dark.png', { maxDiffPixelRatio: 0.04 });
  }
});
