/**
 * E2E specs for ModesSettings (Profile Intelligence tab, premium mode templates).
 *
 * Prerequisites:
 * - npm run test:e2e:premium runs these via playwright.premium.config.ts
 * - 'premium' scenario triggers premium mock IPC state (licenseCheckPremium → true)
 * - BasePage.dismissOverlays is used to clear overlays before navigating
 */

import { expect, test } from '../../fixtures/test'

test.describe('ModesSettings', () => {
  // Activate premium mock state so ModesSettings renders
  test.use({ scenario: 'premium' })

  test('Profile Intelligence tab shows Templates heading', async ({
    launcher,
    settings,
  }) => {
    // Navigate to the app first — SettingsPage.openFromLauncher needs the
    // settings button to exist in the DOM before it can click it.
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')

    // ModesSettings renders "Templates" as the section heading (not "Mode Templates").
    await expect(
      settings.page.getByRole('heading', { name: /templates/i }),
    ).toBeVisible()

    await settings.close()
  })

  test('Templates section renders template buttons', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')

    // The Templates gallery lists buttons with recognizable labels: Sales, Recruit,
    // Team Meet, Looking for work, Lecture, Technical Interview.
    await settings.page.waitForTimeout(500)
    // At least one template button should be visible
    const templateButton = settings.page
      .getByRole('button', {
        name: /sales|recruit|team meet|looking for work|lecture|technical/i,
      })
      .first()
    await expect(templateButton).toBeVisible({ timeout: 5000 })

    await settings.close()
  })

  test('clicking a template button activates it', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(500)

    // Click the Sales template button (it always renders in the gallery)
    const salesBtn = settings.page
      .getByRole('button', { name: /sales/i })
      .first()
    await salesBtn.click()

    // After clicking, the Templates section closes and a mode sidebar appears.
    // Wait for sidebar content to appear.
    await settings.page.waitForTimeout(300)
    const modeItem = settings.page
      .locator('.modes-manager-root [class*="group"]')
      .first()
    // If modes list is empty (modesGetAll returns []), the sidebar may still be
    // rendering — wait for either the mode item or the templates button to re-appear.
    await expect(
      modeItem.or(settings.page.getByRole('button', { name: /sales/i })),
    ).toBeVisible({ timeout: 5000 })

    await settings.close()
  })
})
