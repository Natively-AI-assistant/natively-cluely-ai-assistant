import { test, expect } from '../fixtures/test'

test.describe('Model Selector', () => {
  test('renders model selector window', async ({ modelSelector }) => {
    await modelSelector.goto()
    await expect(modelSelector.page).toHaveURL('/?window=model-selector')
  })

  test('does not use native select elements', async ({ modelSelector }) => {
    await modelSelector.goto()
    await expect(modelSelector.page.locator('select')).toHaveCount(0)
  })

  test('does not use native option elements', async ({ modelSelector }) => {
    await modelSelector.goto()
    await expect(modelSelector.page.locator('option')).toHaveCount(0)
  })

  test('handles no models gracefully', async ({ modelSelector }) => {
    await modelSelector.goto()
    const noModels = modelSelector.page.getByText(/no models/i)
    const loading = modelSelector.page.getByText(/loading models/i)
    await expect(noModels.or(loading)).toBeVisible()
  })
})

test.describe('Model Selector - With Models', () => {
  test.use({ scenario: 'withMeetings' })

  test('shows available model buttons when present', async ({ modelSelector }) => {
    await modelSelector.goto()
    const modelButtons = await modelSelector.getModelButtons()
    // Verify at least one model button is visible
    await expect(modelButtons.first()).toBeVisible()
  })

  test('selecting a model updates display', async ({ modelSelector }) => {
    await modelSelector.goto()
    const modelButtons = await modelSelector.getModelButtons()
    const firstButtonText = await modelButtons.first().textContent()
    expect(firstButtonText).toBeTruthy()
    await modelButtons.first().click()
    await expect(modelSelector.page.getByText(firstButtonText as string)).toBeVisible()
  })
})
