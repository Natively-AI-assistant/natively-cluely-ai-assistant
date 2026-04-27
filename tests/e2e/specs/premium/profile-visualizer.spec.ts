/**
 * E2E specs for ProfileVisualizer.
 *
 * The ProfileVisualizer renders inside SettingsOverlay under the Profile tab
 * (accessible via Settings → Profile Intelligence).
 * Uses the 'premium' scenario which provides full profile data (experience,
 * projects, education) via the mock IPC layer.
 */

import { expect, test } from '../../fixtures/test'

test.describe('ProfileVisualizer', () => {
  test.use({ scenario: 'premium' })

  test('Professional Timeline heading is visible in Profile tab', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(800)

    await expect(
      settings.page.getByRole('heading', { name: /professional timeline/i }),
    ).toBeVisible({ timeout: 10000 })
  })

  test('experience timeline nodes render with company names', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(800)

    // Company names from the premium mock scenario
    await expect(
      settings.page.getByText(/techcorp inc\.|startupxyz/i).first(),
    ).toBeVisible({ timeout: 10000 })

    // Role text
    await expect(
      settings.page
        .getByText(/senior software engineer|software engineer/i)
        .first(),
    ).toBeVisible({ timeout: 5000 })
  })

  test('Featured Projects section renders', async ({ launcher, settings }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(800)

    await expect(
      settings.page.getByRole('heading', { name: /featured projects/i }),
    ).toBeVisible({ timeout: 10000 })

    // Project names from premium mock (use first() to avoid strict mode violation)
    await expect(
      settings.page.getByText(/opentask|devmetrics/i).first(),
    ).toBeVisible({ timeout: 5000 })

    // Project description keywords
    await expect(
      settings.page
        .getByText(/task management|cli tool|engineering velocity/i)
        .first(),
    ).toBeVisible({ timeout: 5000 })
  })

  test('Academic Background section renders', async ({
    launcher,
    settings,
  }) => {
    await launcher.goto()
    await settings.openFromLauncher()
    await settings.switchToTab('Profile Intelligence')
    await settings.page.waitForTimeout(800)

    await expect(
      settings.page.getByRole('heading', { name: /academic background/i }),
    ).toBeVisible({ timeout: 10000 })

    // Institution from premium mock
    await expect(
      settings.page.getByText(/state university/i).first(),
    ).toBeVisible({ timeout: 5000 })

    // Degree info
    await expect(
      settings.page.getByText(/bachelor of science|computer science/i).first(),
    ).toBeVisible({ timeout: 5000 })
  })
})
