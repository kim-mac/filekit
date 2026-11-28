import { expect, test } from '@playwright/test';
import { openImageWorkspace, pick, waitForEstimates, waitForFonts, waitForImage, toolTab } from './helpers';

test.use({ colorScheme: 'light' });

test('home and workspace adapt their layout with the same controls', async ({ page, isMobile }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Images/ })).toBeVisible();
  await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(3);
  for (const category of ['PDF', 'Audio', 'Video']) {
    await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: category, exact: true })).toHaveCount(0);
  }
  await waitForFonts(page);
  const home = await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true, animations: 'disabled' });
  await testInfo.attach('home', { body: home, contentType: 'image/png' });
  const usesSnapshots = ['desktop-chromium', 'android-chromium'].includes(testInfo.project.name);
  if (usesSnapshots) await expect(page).toHaveScreenshot('home.png', { fullPage: true, maxDiffPixelRatio: 0.04 });

  await openImageWorkspace(page);
  await pick(page, 'transparent.png');
  await waitForImage(page, 'transparent.png');
  const tabs = page.getByRole('tablist', { name: 'Available tools' });
  await expect(tabs).toHaveAttribute('aria-orientation', isMobile ? 'horizontal' : 'vertical');
  const positions = await tabs.getByRole('tab').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)));
  if (isMobile) {
    expect(new Set(positions).size).toBe(1);
    expect(await tabs.evaluate(list => list.scrollWidth > list.clientWidth)).toBe(true);
  } else {
    expect(new Set(positions).size).toBe(positions.length);
    await toolTab(page, 'Convert').press('ArrowDown');
    await expect(toolTab(page, 'Crop')).toBeFocused();
    await toolTab(page, 'Convert').focus();
    await page.locator('h1').click();
  }
  await page.getByRole('img', { name: 'Preview of transparent.png' }).evaluate((image: HTMLImageElement) => image.decode());
  const add = await page.getByRole('button', { name: 'Add more images' }).boundingBox();
  const preview = (await page.getByRole('region', { name: 'Preview' }).boundingBox())!;
  const tools = (await page.getByRole('region', { name: 'Tools' }).boundingBox())!;
  const files = (await page.getByRole('region', { name: 'Files' }).boundingBox())!;
  const output = (await page.getByRole('region', { name: 'Export' }).boundingBox())!;
  expect(add!.height).toBeGreaterThanOrEqual(44);
  expect(files.width).toBeCloseTo(preview.width);
  if (isMobile) {
    expect(tools.y).toBeGreaterThan(preview.y + preview.height);
    expect(files.y).toBeGreaterThan(tools.y + tools.height);
    expect(output.y).toBeGreaterThan(files.y + files.height);
    expect(tools.x).toBeCloseTo(preview.x);
  } else {
    expect(tools.x).toBeGreaterThan(preview.x + preview.width);
    expect(tools.y).toBeCloseTo(preview.y);
    expect(files.x).toBeCloseTo(preview.x);
    expect(files.y - preview.y - preview.height).toBeLessThan(24);
    expect(output.x).toBeCloseTo(tools.x);
    expect(output.y).toBeGreaterThan(tools.y + tools.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => document.documentElement.clientWidth));

  await waitForFonts(page);
  await waitForEstimates(page);
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

  await toolTab(page, 'Crop').click();
  await page.getByRole('radio', { name: '4:5', exact: true }).check();
  const cropBox = page.getByRole('group', { name: 'Crop box' });
  await expect(cropBox).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resize crop from bottom right' })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await waitForFonts(page);
  await waitForEstimates(page);
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
  await toolTab(page, 'Remove background').click();
  await expect(page.getByRole('radio', { name: 'Transparent', exact: true })).toBeChecked();
  const removal = page.getByRole('region', { name: 'Tools' });
  // Keep the floating header out of the card capture when Playwright scrolls to fit it.
  const style = '.site-header { visibility: hidden; }';
  await waitForFonts(page);
  await testInfo.attach('background-controls', { body: await removal.screenshot({ style }), contentType: 'image/png' });
  if (usesSnapshots) await expect(removal).toHaveScreenshot('background-controls.png', { style, maxDiffPixelRatio: 0.04 });

  const lightBackground = await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).not.toHaveCSS('background-color', lightBackground);
});
