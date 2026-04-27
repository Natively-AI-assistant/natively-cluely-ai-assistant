/**
 * E2E specs for PremiumUpgradeModal.
 *
 * The modal is triggered by the "Unlock Pro" button in the Profile tab header.
 * Uses the 'default' (non-premium) scenario so the upgrade path is accessible.
 * The "Unlock Pro" button lives in the "Profile Intelligence" tab.
 */

import { expect, test } from '../../fixtures/test'

test.describe('PremiumUpgradeModal', () => {
  // Use non-premium scenario so the "Unlock Pro" button triggers the modal
  test.use({ scenario: 'default' })

  test('modal appears when Unlock Pro button is clicked', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    // Switch to the Profile tab where the "Unlock Pro" button is located
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(500)

    // Click the "Unlock Pro" button in the profile tab header
    await settings.page.getByText('Unlock Pro').click()

    // Wait for the modal overlay to appear
    await expect(
      settings.page.locator('.fixed.inset-0.z-\\[200\\]'),
    ).toBeVisible({ timeout: 5000 })

    // Verify modal heading
    await expect(
      settings.page.getByRole('heading', { name: /unlock pro/i }),
    ).toBeVisible()

    // Verify "Already purchased?" section with license key input
    await expect(
      settings.page.getByPlaceholder(/enter your license key/i),
    ).toBeVisible()

    // Verify Activate button
    await expect(
      settings.page.getByRole('button', { name: /activate license/i }),
    ).toBeVisible()

    await settings.close()
  })

  test('hardware ID is displayed in the modal', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(500)

    // Open the modal
    await settings.page.getByText('Unlock Pro').click()
    await expect(
      settings.page.locator('.fixed.inset-0.z-\\[200\\]'),
    ).toBeVisible({ timeout: 5000 })

    // Wait for hardware ID to load (it uses a delayed IPC call)
    await settings.page.waitForTimeout(2000)

    // Verify the "Device ID" label is present
    await expect(settings.page.getByText(/device id/i)).toBeVisible()

    await settings.close()
  })

  test('license key activation shows error for invalid key', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(500)

    // Open the modal
    await settings.page.getByText('Unlock Pro').click()
    await expect(
      settings.page.locator('.fixed.inset-0.z-\\[200\\]'),
    ).toBeVisible({ timeout: 5000 })

    // Type an invalid license key
    const licenseInput = settings.page.getByPlaceholder(
      /enter your license key/i,
    )
    await expect(licenseInput).toBeVisible()
    await licenseInput.fill('INVALID-LICENSE-KEY-12345')

    // Activate button should be enabled
    const activateBtn = settings.page.getByRole('button', {
      name: /activate license/i,
    })
    await expect(activateBtn).toBeEnabled()
    await activateBtn.click()

    // Error message should appear for invalid key
    await expect(
      settings.page.getByText(/activation failed|invalid|error/i),
    ).toBeVisible({ timeout: 8000 })

    await settings.close()
  })
})
