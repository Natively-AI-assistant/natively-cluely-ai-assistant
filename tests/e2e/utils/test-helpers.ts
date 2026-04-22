import { Page, expect } from '@playwright/test'

/**
 * Wait for app to be fully initialized
 */
export async function waitForAppReady(page: Page, timeout = 15000): Promise<void> {
  await page.locator('#launcher-container, [data-testid="launcher-container"]').waitFor({
    state: 'visible',
    timeout,
  })
}

/**
 * Assert element is visible with better error messages
 */
export async function assertVisible(
  page: Page,
  selector: string,
  fallbackSelector?: string,
  timeout = 5000,
): Promise<void> {
  const locator = fallbackSelector
    ? page.locator(`${selector}, ${fallbackSelector}`)
    : page.locator(selector)
  await expect(locator).toBeVisible({ timeout })
}

/**
 * Assert element contains expected text
 */
export async function assertText(
  page: Page,
  selector: string,
  expectedText: string | RegExp,
  timeout = 5000,
): Promise<void> {
  await expect(page.locator(selector)).toContainText(expectedText, { timeout })
}

/**
 * Assert element count with meaningful error
 */
export async function assertCount(
  page: Page,
  selector: string,
  expectedCount: number,
  timeout = 5000,
): Promise<void> {
  await expect(page.locator(selector)).toHaveCount(expectedCount, { timeout })
}

/**
 * Assert element has specific attribute
 */
export async function assertAttribute(
  page: Page,
  selector: string,
  attribute: string,
  expectedValue: string | RegExp,
  timeout = 5000,
): Promise<void> {
  await expect(page.locator(selector)).toHaveAttribute(attribute, expectedValue, { timeout })
}

/**
 * Take screenshot for debugging
 */
export async function debugScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.DEBUG_SCREENSHOTS) {
    await page.screenshot({ path: `test-results/debug-${name}.png` })
  }
}
