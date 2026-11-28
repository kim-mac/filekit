import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { holdRequest, openImageWorkspace, outputFormat, pick, selectFormat, status, toolTab, waitForImage } from './helpers';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`main screens and states meet axe serious and critical rules in ${colorScheme}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium' && info.project.name !== 'android-chromium', 'Axe sweep on desktop and touch');
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });

    async function audit(state: string) {
      const { violations } = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
      expect.soft(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
        .map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), state).toEqual([]);
    }

    await page.goto('/');
    await audit('home');
    await page.goto('/about/licenses/');
    await audit('licenses');
    await openImageWorkspace(page);
    await audit('empty workspace');

    await pick(page, 'transparent.png', 'unsupported.txt', 'broken.jpg');
    await waitForImage(page, 'transparent.png');
    await expect(page.getByRole('region', { name: 'Files' }).getByRole('alert')).toHaveCount(2);
    await audit('loaded workspace and intake errors');

    await page.getByRole('button', { name: 'Details' }).click();
    await audit('details');
    await page.keyboard.press('Escape');
    await outputFormat(page).focus();
    await expect(outputFormat(page)).toBeFocused();
    await audit('format picker');

    await selectFormat(page, 'JPG');
    const text = "JPG doesn't support transparency — transparent areas will be filled with white.";
    await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Apply convert' }).click();
    await waitForImage(page, 'transparent.png');
    const region = page.getByRole('region', { name: 'Export' });
    await expect(region.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    await audit('conversion and transparency warning');
    await region.getByRole('button', { name: 'Dismiss notice' }).click();
    await expect(region.getByText(text, { exact: true })).toHaveCount(0);

    for (const tool of ['Crop', 'Blur', 'Remove background', 'Upscale']) {
      await toolTab(page, tool).click();
      await expect(page.getByRole('button', { name: `Apply ${tool.toLowerCase()}` })).toBeEnabled();
      await audit(tool);
    }

    const releaseModel = await holdRequest(page.context(), /\/upscale-models\/chunks\//);
    try {
      await page.getByRole('button', { name: 'Apply upscale' }).click();
      await expect(page.getByRole('progressbar', { name: 'Model download progress' })).toBeVisible();
      await audit('running upscale and model download');
      await page.getByRole('button', { name: 'Cancel edit' }).click();
      await expect(page.getByText('Edit canceled.')).toBeVisible();
      await audit('canceled edit');
    } finally {
      await releaseModel();
    }

    const first = page.locator('.file-tile').first();
    if (info.project.name === 'desktop-chromium') await first.hover();
    await first.getByRole('button', { name: 'Rename transparent.png' }).click();
    const name = page.getByRole('textbox', { name: 'File name' });
    await name.fill('');
    await name.press('Enter');
    await audit('inline filename error');
    await name.press('Escape');
    await first.getByRole('button', { name: 'Actions for transparent.png' }).click();
    await audit('file actions menu');
    await page.keyboard.press('Escape');

    let allowCodec!: () => void;
    const blocked = new Promise<void>(resolve => { allowCodec = resolve; });
    await page.context().route(/mozjpeg_enc-.*\.wasm$/, async route => {
      await blocked;
      await route.abort().catch(() => undefined);
    });
    try {
      await region.getByRole('button', { name: 'Export image' }).click();
      await expect(region.getByRole('progressbar', { name: 'Export progress' })).toBeVisible();
      await audit('running export');
      await region.getByRole('button', { name: 'Cancel export' }).click();
      await expect(status(page)).toHaveText('Export canceled.');
      await audit('canceled export');
    } finally {
      allowCodec();
      await page.context().unroute(/mozjpeg_enc-.*\.wasm$/);
    }

    await region.getByRole('button', { name: 'Export image' }).click();
    await expect(region.getByRole('link', { name: 'Save to device' })).toBeVisible();
    await audit('export ready');
  });
}
