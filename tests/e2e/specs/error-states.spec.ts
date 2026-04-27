import { expect, test } from '../fixtures/test'

test.describe('Error States', () => {
  test('app loads when Electron API mock is configured', async ({
    launcher,
  }) => {
    await launcher.goto()
    await expect(launcher.page.locator('#launcher-container')).toBeVisible({
      timeout: 15000,
    })
  })

  test('settings popup renders with default empty settings', async ({
    page,
    settings,
  }) => {
    void settings
    await page.goto('/?window=settings')
    await expect(page.getByText('Transcript')).toBeVisible()
    await expect(page.getByText('Detectable')).toBeVisible()
  })

  test('empty model list shows appropriate message', async ({
    modelSelector,
    page,
  }) => {
    await modelSelector.goto()
    const noModels = page.getByText(/no models/i)
    const loading = page.getByText(/loading models/i)
    await expect(noModels.or(loading)).toBeVisible()
  })

  test('launcher search input is focusable', async ({ launcher, page }) => {
    await launcher.goto()
    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeVisible()
    await searchInput.click()
    await expect(searchInput).toBeFocused()
  })

  test('cropper container renders', async ({ cropper, page }) => {
    await cropper.goto()
    // Check for the cropper wrapper (canvas parent)
    await expect(
      page.locator('.w-screen.h-screen.cursor-default'),
    ).toBeVisible()
    // Check for canvas element (the actual cropper canvas)
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('model selector renders', async ({ modelSelector, page }) => {
    await modelSelector.goto()
    // Check the model selector page renders properly
    await expect(page.locator('body')).toBeVisible()
  })

  test('launcher container has data-testid', async ({ launcher, page }) => {
    await launcher.goto()
    await expect(page.getByTestId('launcher-container')).toBeVisible()
  })
})
