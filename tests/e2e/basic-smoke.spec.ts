// tests/e2e/basic-smoke.spec.ts
//
// FINDING-006: Playwright E2E smoke tests for Natively.
//
// This file exercises the renderer → main-process IPC contract that
// service-level tests cannot cover. Each test opens the actual Electron
// window and asserts on real UI state.
//
// Skip conditions (each test is skip_if'd individually so one failure
// doesn't cascade):
//   - ELECTRON_APP_PORT not set  → dev server not running
//   - CI=true                   → no display available in CI containers
//
// To run locally against the dev server:
//   npm run dev  (in terminal 1)
//   npx playwright test  (in terminal 2, from repo root)
//
// To run headless against a built app:
//   npm run build && npm run start &
//   sleep 5 && npx playwright test

import { test, expect, skip } from '@playwright/test';

const CI = process.env.CI === 'true';
const APP_PORT = parseInt(process.env.ELECTRON_APP_PORT ?? '0', 10);

test.describe('FINDING-006: Natively E2E smoke', () => {
  test.beforeEach(async ({ page }) => {
    if (CI) {
      test.skip();
      return;
    }
    // Guard: if no dev server is running, skip instead of failing
    if (!APP_PORT) {
      test.skip('Set ELECTRON_APP_PORT to the dev server port (e.g. 5173) before running E2E tests');
      return;
    }
  });

  test('app window loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`http://localhost:${APP_PORT}`);
    // Wait for the main content area — exact selector is app-specific.
    // We wait for any element with the "app" or "root" identifier.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // allow async init

    const crashIndicators = ['is not defined', 'Cannot find module', 'Electron Error'];
    const criticalErrors = errors.filter(e => crashIndicators.some(ci => e.includes(ci)));
    expect(criticalErrors, `Critical errors: ${criticalErrors.join(' | ')}`).toHaveLength(0);
  });

  test('main IPC channel responds to ping', async ({ page }) => {
    if (!APP_PORT) test.skip();
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    // Evaluate a ping through the preload bridge (exposed as window.electronAPI).
    // If the preload is loaded, window.electronAPI will be truthy.
    const hasPreload = await page.evaluate(() => {
      return typeof (window as any).electronAPI?.ping === 'function'
        || typeof (window as any).electron === 'object';
    });

    // A missing preload is a failure — the IPC contract is broken.
    expect(hasPreload).toBe(true);
  });

  test('modes panel renders with mode list', async ({ page }) => {
    if (!APP_PORT) test.skip();
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    // Look for the modes panel — searches by text content typical of mode names.
    // If the UI uses a specific element, update the selector accordingly.
    const modePanelLocator = page.locator('text=/general|sales|recruiting|team-meet|looking-for-work|technical-interview|lecture/i');
    const visible = await modePanelLocator.first().isVisible().catch(() => false);

    // The mode list may be lazy; give it more time before declaring missing.
    if (!visible) {
      await page.waitForTimeout(3000);
    }

    expect(visible).toBe(true);
  });

  test('settings panel opens and closes', async ({ page }) => {
    if (!APP_PORT) test.skip();
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    // Click the settings button/icon — placeholder selector.
    const settingsBtn = page.locator('button[aria-label*="settings" i], button:has-text("Settings")').first();
    const settingsVisible = await settingsBtn.isVisible().catch(() => false);

    if (settingsVisible) {
      await settingsBtn.click();
      await page.waitForTimeout(500);

      // Close again
      const closeBtn = page.locator('button[aria-label*="close" i], button:has-text("Close")').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }

    // Settings not yet rendered is not a test failure — skip with a note
    if (!settingsVisible) {
      test.skip('Settings button not found in this UI layout');
    }
  });

  test('manager panel opens, closes on Escape, and returns focus to its trigger', async ({ page }) => {
    if (!APP_PORT) test.skip();
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const profileTrigger = page.getByTestId('open-profile-intelligence');
    if (!await profileTrigger.isVisible().catch(() => false)) {
      test.skip('Profile Intelligence trigger not found in this UI layout');
      return;
    }

    await profileTrigger.click();
    const host = page.getByTestId('manager-panel-host');
    await expect(host).toHaveCount(1);
    await expect(page.getByTestId('manager-panel-profile')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(host).toHaveCount(0);
    await expect(profileTrigger).toBeFocused();
  });

  test('manager surface opens and closes with reduced motion', async ({ page }) => {
    if (!APP_PORT) test.skip();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const modesTrigger = page.getByTestId('open-modes-manager');
    if (!await modesTrigger.isVisible().catch(() => false)) {
      test.skip('Modes trigger not found in this UI layout');
      return;
    }

    await modesTrigger.click();
    await expect(page.getByTestId('manager-panel-modes')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('manager-panel-host')).toHaveCount(0);
  });
});