import { test, expect } from '../fixtures/test'

test.describe('Overlay', () => {
  test('renders top pill with logo and controls', async ({ overlay }) => {
    await overlay.goto()

    await expect(await overlay.getTopPill()).toBeVisible()
    await expect(await overlay.getLogo()).toBeVisible()
    await expect(await overlay.getHideButton()).toBeVisible()
    await expect(await overlay.getStopButton()).toBeVisible()
  })

  test('renders quick action chips', async ({ overlay }) => {
    await overlay.goto()

    const chips = await overlay.getAllQuickActionChips()
    await expect(chips.first()).toBeVisible()
  })

  test('shows What to answer chip', async ({ overlay }) => {
    await overlay.goto()

    await expect(await overlay.getQuickActionChip('What to answer')).toBeVisible()
  })

  test('shows Clarify chip', async ({ overlay }) => {
    await overlay.goto()

    await expect(await overlay.getQuickActionChip('Clarify')).toBeVisible()
  })

  test('input field accepts text', async ({ overlay }) => {
    await overlay.goto()

    await overlay.typeInInput('Hello, this is a test message')

    await expect(await overlay.getInputField()).toHaveValue('Hello, this is a test message')
  })

  test('Enter key does not crash overlay', async ({ overlay }) => {
    await overlay.goto()

    await overlay.typeInInput('Test message')
    await overlay.pressEnter()

    await expect(await overlay.getShell()).toBeVisible()
  })

  test('model selector button exists', async ({ overlay }) => {
    await overlay.goto()

    await expect(await overlay.getModelSelectorButton()).toBeVisible()
  })

  test('overlay shell renders', async ({ overlay, page }) => {
    await overlay.goto()
    // Check the overlay shell surface element
    await expect(page.locator('.overlay-shell-surface')).toBeVisible()
  })

  test('overlay pill renders', async ({ overlay, page }) => {
    await overlay.goto()
    // Check the overlay pill surface element
    await expect(page.locator('.overlay-pill-surface').first()).toBeVisible()
  })

  test('multiple messages can be entered', async ({ overlay }) => {
    await overlay.goto()
    await overlay.typeInInput('First message')
    await expect(await overlay.getInputField()).toHaveValue('First message')
    await overlay.typeInInput('Second message')
    await expect(await overlay.getInputField()).toHaveValue('Second message')
  })
})
