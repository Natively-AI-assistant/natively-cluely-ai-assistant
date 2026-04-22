import { Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class SettingsPage extends BasePage {
  private readonly TABS = [
    'General',
    'Natively API',
    'AI Providers',
    'Calendar',
    'Audio',
    'Keybinds',
    'Profile Intelligence',
    'About',
  ] as const

  constructor(page: Page) {
    super(page)
  }

  async openFromLauncher() {
    await this.dismissOverlays()
    await this.page.getByTestId('settings-button').click()
    await expect(this.page.locator('#settings-panel')).toBeVisible()
  }

  async close() {
    await this.dismissOverlays()
    // Wait for settings panel to be visible and stable first
    const settingsPanel = this.page.locator('#settings-panel')
    await settingsPanel.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    // Use page.evaluate to click the close button directly via JS to bypass overlays
    await this.page.evaluate(() => {
      const closeBtn = document.querySelector('#settings-panel button[title="Close"], #settings-panel button.Close, #settings-panel button[class*="close"]')
        || Array.from(document.querySelectorAll('#settings-panel button')).find((b: HTMLButtonElement) => b.textContent?.trim() === 'Close')
      if (closeBtn instanceof HTMLElement) closeBtn.click()
    }).catch(() => {})
    // If JS click didn't work, try Playwright's locator
    const closeButton = settingsPanel.getByRole('button', { name: 'Close' })
    await closeButton.click({ force: true }).catch(() => {})
    await expect(settingsPanel).not.toBeVisible()
  }

  async switchToTab(tab: string) {
    // Use flexible JS click inside the settings panel to handle icon+text buttons
    // Don't call dismissOverlays here - it can close the settings panel
    await this.clickButtonInsideFlexible('#settings-panel', tab)
  }

  async getSidebarTabs() {
    const sidebar = this.page.locator('#settings-panel').locator('nav, [role="tablist"], aside').first()
    return sidebar.locator('button')
  }

  async getContentArea() {
    return this.page.locator('#settings-panel .flex-1.overflow-y-auto')
  }

  // General tab
  async getThemeDropdown() {
    return this.page.getByText('Theme').locator('..').locator('select, button, [role="combobox"]').first()
  }

  async getOpacitySlider() {
    return this.page.locator('input[type="range"]').first()
  }

  async getUndetectableToggle() {
    return this.page.getByRole('switch', { name: /undetectable/i }).or(
      this.page.locator('text="Undetectable"').locator('..').locator('[role="switch"], input[type="checkbox"]').first()
    )
  }

  async getMousePassthroughToggle() {
    return this.page.getByRole('switch', { name: /mouse passthrough/i }).or(
      this.page.locator('text="Mouse Passthrough"').locator('..').locator('[role="switch"], input[type="checkbox"]').first()
    )
  }

  async getQuitButton() {
    return this.page.getByRole('button', { name: /quit/i })
  }

  async getAllTabNames() {
    return this.TABS
  }
}
