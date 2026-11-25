import { expect, test } from '@playwright/test';
import { openImageWorkspace, pick, waitForImage } from './helpers';

test.use({ colorScheme: 'light' });

test('home and workspace adapt their layout with the same controls', async ({ page, isMobile }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Images/ })).toBeVisible();
  await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(3);
  for (const category of ['PDF', 'Audio', 'Video']) {
    await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: category, exact: true })).toHaveCount(0);
  }
  const home = await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true, animations: 'disabled' });
  await testInfo.attach('home', { body: home, contentType: 'image/png' });
  const usesSnapshots = ['desktop-chromium', 'android-chromium'].includes(testInfo.project.name);
  if (usesSnapshots) await expect(page).toHaveScreenshot('home.png', { fullPage: true, maxDiffPixelRatio: 0.04 });

  await openImageWorkspace(page);
  await pick(page, 'transparent.png');
  await waitForImage(page, 'transparent.png');
  await page.getByRole('img', { name: 'Preview of transparent.png' }).evaluate((image: HTMLImageElement) => image.decode());
  const add = await page.getByRole('button', { name: 'Add images' }).boundingBox();
  const preview = await page.getByRole('region', { name: 'Preview' }).boundingBox();
  const sidebar = await page.getByRole('complementary').boundingBox();
  expect(add!.height).toBeGreaterThanOrEqual(44);
  if (isMobile) {
    expect(sidebar!.y).toBeGreaterThan(preview!.y + preview!.height);
    expect(sidebar!.x).toBeCloseTo(preview!.x);
  } else {
    expect(sidebar!.x).toBeGreaterThan(preview!.x + preview!.width);
    expect(sidebar!.y).toBeCloseTo(preview!.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));

  const workspace = await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true, animations: 'disabled' });
  await testInfo.attach('workspace', { body: workspace, contentType: 'image/png' });

  if (usesSnapshots) {
    // Mobile hosts can wrap text below the fold differently. Keep the
    // full-page capture above and compare a fixed viewport for the baseline.
    await expect(page).toHaveScreenshot(isMobile ? 'workspace-viewport.png' : 'workspace.png', {
      fullPage: !isMobile,
      maxDiffPixelRatio: 0.04,
    });
  }

  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByRole('radio', { name: '4:5', exact: true }).check();
  const cropBox = page.getByRole('group', { name: 'Crop box' });
  await expect(cropBox).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resize crop from bottom right' })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  const crop = await page.screenshot({ path: testInfo.outputPath('crop.png'), fullPage: true, animations: 'disabled' });
  await testInfo.attach('crop', { body: crop, contentType: 'image/png' });
  if (usesSnapshots) {
    await expect(isMobile ? page.getByRole('region', { name: 'Preview' }) : page).toHaveScreenshot('crop.png', {
      fullPage: !isMobile, animations: 'disabled', maxDiffPixelRatio: 0.04,
    });
    if (isMobile) {
      await expect(page.getByRole('region', { name: 'Tools' })).toHaveScreenshot('crop-controls.png', {
        maxDiffPixelRatio: 0.04,
      });
    }
  }
});
