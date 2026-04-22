import { test, expect } from '../fixtures/test'

test.describe('Settings @settings', () => {
  test('opens settings overlay from launcher @smoke', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await expect(settings.page.locator('#settings-panel')).toBeVisible()
  })

  test('closes settings overlay', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.close()
    await expect(settings.page.locator('#settings-panel')).not.toBeVisible()
  })

  test('shows all sidebar items', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    const tabs = await settings.getSidebarTabs()
    // 8 tabs + Quit Natively button = 9 buttons total
    await expect(tabs).toHaveCount(9)
  })

  test('switches between all tabs', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()

    // General tab - verify by checking Theme content
    await settings.switchToTab('General')
    await expect(settings.page.getByText('Theme')).toBeVisible()

    // Natively API tab
    await settings.switchToTab('Natively API')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()

    // Profile tab
    await settings.switchToTab('Profile Intelligence')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()

    // AI Providers tab
    await settings.switchToTab('AI Providers')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()

    // Calendar tab
    await settings.switchToTab('Calendar')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()

    // Audio tab
    await settings.switchToTab('Audio')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()

    // Keybinds tab
    await settings.switchToTab('Keybinds')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()

    // About tab
    await settings.switchToTab('About')
    await expect(settings.page.locator('#settings-panel')).toBeVisible()
  })

  test('shows General tab content by default', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await expect(settings.page.getByText('Theme')).toBeVisible()
  })

  test('shows Theme dropdown', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await expect(settings.page.getByText('Theme')).toBeVisible()
  })

  test('shows Quit Natively button', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    const quitButton = await settings.getQuitButton()
    await expect(quitButton).toBeVisible()
  })

  test('shows Interface Opacity slider', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    const slider = await settings.getOpacitySlider()
    await expect(slider).toBeVisible()
  })

  test('navigation: settings tab switch to AI Providers and back', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('AI Providers')
    await settings.switchToTab('General')
    // Verify General tab content shows Theme
    await expect(settings.page.getByText('Theme')).toBeVisible()
  })

  test('settings panel has correct structure', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    const contentArea = await settings.getContentArea()
    await expect(contentArea).toBeVisible()
  })

  test('settings close and reopen cycle', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await expect(settings.page.locator('#settings-panel')).toBeVisible()
    await settings.close()
    await expect(settings.page.locator('#settings-panel')).not.toBeVisible()
    await settings.openFromLauncher()
    await expect(settings.page.locator('#settings-panel')).toBeVisible()
  })
})
