import { Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class LauncherPage extends BasePage {
  constructor(public page: Page) {
    super(page)
  }

  async goto() {
    await this.dismissOverlays()
    await this.page.goto('/')
    await expect(this.page.locator('#launcher-container')).toBeVisible({ timeout: 15000 })
  }

  async isReady() {
    await this.dismissOverlays()
    await expect(this.page.locator('#launcher-container')).toBeVisible()
  }

  async clickStartNatively() {
    await this.dismissOverlays()
    await this.page.getByRole('button', { name: 'Start Natively' }).click()
  }

  async clickSettingsGear() {
    await this.dismissOverlays()
    await this.page.getByTestId('settings-button').click()
  }

  async clickNavigationArrows(direction: 'left' | 'right') {
    await this.dismissOverlays()
    const navButtons = this.page.locator('#launcher-container header button')
    if (direction === 'left') {
      await navButtons.first().click()
    } else {
      await navButtons.last().click()
    }
  }

  async searchFor(text: string) {
    await this.dismissOverlays()
    const searchInput = this.page.getByPlaceholder(/search/i)
    await searchInput.click()
    await searchInput.fill(text)
    await expect(searchInput).toHaveValue(text)
  }

  async getSearchInput() {
    return this.page.getByPlaceholder(/search/i)
  }

  async getMeetingItems() {
    return this.page.locator('[data-testid="meeting-item"], main .group.relative')
  }

  async getRefreshButton() {
    await this.dismissOverlays()
    return this.page.getByRole('button', { name: /refresh/i })
  }

  async getCalendarCard() {
    return this.page.getByText(/link your calendar|calendar linked/i)
  }
}
