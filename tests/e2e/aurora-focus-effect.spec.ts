import { expect, test } from '@playwright/test';

const CI = process.env.CI === 'true';
const APP_PORT = parseInt(process.env.ELECTRON_APP_PORT ?? '0', 10);
const INPUT_SELECTOR = '[data-testid="overlay-chat-input"]';

test.describe('Aurora meeting-input focus effect', () => {
  test.beforeEach(async ({ page }) => {
    if (CI) {
      test.skip();
      return;
    }
    if (!APP_PORT) {
      test.skip('Set ELECTRON_APP_PORT to the dev server port before running E2E tests');
      return;
    }

    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');
  });

  for (const theme of ['default', 'liquid-glass', 'modern'] as const) {
    test(`uses the Aurora focus animation in ${theme}`, async ({ page }) => {
      const input = page.locator(INPUT_SELECTOR).first();
      if (await input.count() === 0) {
        test.skip('meeting overlay input is not mounted in this harness');
        return;
      }

      await page.evaluate((selectedTheme) => {
        const inputEl = document.querySelector<HTMLInputElement>(
          '[data-testid="overlay-chat-input"]',
        );
        const themeHost = inputEl?.closest<HTMLElement>('[data-interface-theme]');
        if (!inputEl || !themeHost) throw new Error('overlay input or theme host not found');
        if (selectedTheme === 'default') themeHost.removeAttribute('data-interface-theme');
        else themeHost.dataset.interfaceTheme = selectedTheme;
        inputEl.focus();
      }, theme);

      await expect(input).toHaveCSS('animation-name', theme === 'default' ? 'aurora' : 'aurora-theme');
    });
  }

  test('suppresses Aurora motion when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const input = page.locator(INPUT_SELECTOR).first();
    if (await input.count() === 0) {
      test.skip('meeting overlay input is not mounted in this harness');
      return;
    }

    await input.focus();
    await expect(input).toHaveCSS('animation-name', 'none');
  });
});
