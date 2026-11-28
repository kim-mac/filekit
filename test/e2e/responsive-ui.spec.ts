import { expect, test } from '@playwright/test';
import { openImageWorkspace, pick, toolTab, waitForFonts, waitForImage } from './helpers';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`fits the supported widths in ${colorScheme}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'Viewport and theme sweep uses Chromium');
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });

    async function checkWidth() {
      const wideElements = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll('main, header, .workspace-card, .panel-heading, .export-buttons, .tool-bar, .option-fields, .notice')]
          .filter(node => node.getBoundingClientRect().right > width ||
            (!node.matches('.tool-panel[data-orientation="horizontal"] .tool-bar') && node.scrollWidth > node.clientWidth + 1))
          .map(node => node.className || node.tagName);
      });
      expect(wideElements).toEqual([]);
    }

    for (const width of [360, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: width <= 768 ? 900 : 960 });
      await page.goto('/');
      await waitForFonts(page);
      await checkWidth();
      if (width !== 1024) await info.attach(`home-${width}-${colorScheme}`, {
        body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
      });
      await openImageWorkspace(page);
      await checkWidth();
      if (width !== 1024) await info.attach(`empty-${width}-${colorScheme}`, {
        body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
      });
      await pick(page, 'oriented.png', 'transparent.png', 'reference.webp');
      await waitForImage(page, 'oriented.png');
      await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeEnabled();
      await waitForFonts(page);
      for (const tool of ['Convert', 'Crop', 'Blur', 'Remove background', 'Upscale']) {
        await toolTab(page, tool).click();
        await expect(page.getByRole('button', { name: `Apply ${tool.toLowerCase()}` })).toBeVisible();
        await checkWidth();
      }
      await toolTab(page, 'Convert').click();
      if (width !== 1024) await info.attach(`workspace-${width}-${colorScheme}`, {
        body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
      });
    }
  });
}
