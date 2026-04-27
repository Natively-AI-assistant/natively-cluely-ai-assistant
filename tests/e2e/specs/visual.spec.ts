/**
 * Visual regression tests using Playwright screenshots.
 * Run with: npm run test:e2e:visual
 * Tagged with @visual for selective execution.
 */
import { expect, test } from '../fixtures/test'

test.describe('Visual Regression @visual', () => {
  test('launcher renders correctly @visual', async ({ page, launcher }) => {
    await launcher.goto()
    // Mask window controls for cross-platform snapshot compatibility:
    // On Windows, custom minimize/maximize/close buttons are rendered in the DOM.
    // On macOS, WindowControls returns null (native traffic lights are used).
    // Masking ensures the same baseline works on both platforms without diffs.
    const windowControls = page.locator('[data-testid="window-controls"]')
    await expect(page).toHaveScreenshot('launcher-default.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: [windowControls],
      maskColor: '#0f172a',
    })
  })

  test('settings panel renders correctly @visual', async ({
    page,
    launcher,
  }) => {
    await launcher.goto()
    await launcher.clickSettingsGear()
    await expect(page.locator('#settings-panel')).toHaveScreenshot(
      'settings-panel.png',
      {
        maxDiffPixelRatio: 0.02,
      },
    )
  })

  test('overlay renders correctly @visual', async ({ page, overlay }) => {
    await overlay.goto()
    await expect(page.locator('.overlay-shell-surface')).toHaveScreenshot(
      'overlay-shell.png',
      {
        maxDiffPixelRatio: 0.02,
      },
    )
  })

  test('cropper renders correctly @visual', async ({ page, cropper }) => {
    await cropper.goto()
    await expect(page).toHaveScreenshot('cropper.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    })
  })

  test('model selector renders correctly @visual', async ({
    page,
    modelSelector,
  }) => {
    // Clear any cached state from previous runs
    await page.addInitScript(() => {
      localStorage.removeItem('cached-models')
      localStorage.removeItem('cached-current-model')
    })
    await modelSelector.goto()
    // Wait for the loading spinner to disappear and models to render
    await page.waitForFunction(
      () => {
        return !document.querySelector('.animate-spin')
      },
      { timeout: 10000 },
    )
    // Wait a bit more for the UI to settle
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('model-selector.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})
