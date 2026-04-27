import { expect, test } from '../fixtures/test'

test.describe('Performance @performance', () => {
  test('launcher container renders with search', async ({ launcher, page }) => {
    await launcher.goto()
    await expect(page.locator('#launcher-container')).toBeVisible()
    await expect(page.locator('[data-testid="search-input"]')).toBeVisible()
  })

  test('settings panel opens and has content', async ({ launcher, page }) => {
    await launcher.goto()
    await launcher.clickSettingsGear()
    await expect(page.locator('#settings-panel')).toBeVisible()
    await expect(page.locator('nav')).toBeVisible()
  })

  test('overlay shell renders with pill', async ({ overlay, page }) => {
    await overlay.goto()
    await expect(page.locator('.overlay-shell-surface')).toBeVisible()
    await expect(page.locator('.overlay-pill-surface').first()).toBeVisible()
  })

  test('cropper canvas renders', async ({ cropper, page }) => {
    await cropper.goto()
    await expect(page.locator('canvas')).toBeVisible()
  })
})
