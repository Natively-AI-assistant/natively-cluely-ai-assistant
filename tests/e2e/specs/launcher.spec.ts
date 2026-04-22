import { test, expect } from '../fixtures/test'

test.describe('Launcher', () => {
  test('shows launcher after startup sequence @smoke', async ({ launcher }) => {
    await launcher.goto()
    await expect(launcher.page).toHaveURL('/')
  })

  test('displays Start Natively button @smoke', async ({ launcher }) => {
    await launcher.goto()
    const startButton = launcher.page.getByRole('button', { name: 'Start Natively' })
    await expect(startButton).toBeVisible()
    await expect(startButton).toBeEnabled()
  })

  test('search input accepts and displays text @smoke', async ({ launcher }) => {
    await launcher.goto()
    await launcher.searchFor('test query')
    const searchInput = await launcher.getSearchInput()
    await expect(searchInput).toHaveValue('test query')
    await expect(searchInput).toBeVisible()
  })

  test('search input can be focused', async ({ launcher }) => {
    await launcher.goto()
    const searchInput = await launcher.getSearchInput()
    await searchInput.click()
    await expect(searchInput).toBeFocused()
  })

  test('navigation: launcher -> settings -> close returns to launcher @navigation', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await expect(settings.page.locator('#settings-panel')).toBeVisible()
    await settings.close()
    await expect(launcher.page.locator('#launcher-container')).toBeVisible()
  })

  test('displays empty state when no meetings exist', async ({ launcher }) => {
    await launcher.goto()
    const meetingItems = await launcher.getMeetingItems()
    await expect(meetingItems).toHaveCount(0)
  })

  test('refresh button has correct attributes', async ({ launcher }) => {
    await launcher.goto()
    const refreshButton = await launcher.getRefreshButton()
    await expect(refreshButton).toBeVisible()
    await expect(refreshButton).toHaveAttribute('title', 'Refresh State')
  })
})
