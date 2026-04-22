import { Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class OverlayPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  async goto() {
    await this.dismissOverlays()
    await this.page.goto('/?window=overlay')
    await expect(this.page.locator('.overlay-shell-surface')).toBeVisible({ timeout: 10000 })
  }

  async getTopPill() {
    return this.page.locator('.rounded-full.overlay-pill-surface')
  }

  async getLogo() {
    return this.page.locator('img[alt="Natively"]')
  }

  async getHideButton() {
    return this.page.getByRole('button', { name: 'Hide' })
  }

  async getStopButton() {
    return this.page.locator('.overlay-pill-surface button').last()
  }

  async getQuickActionChip(name: string) {
    return this.page.locator('.overlay-chip-surface').filter({ hasText: name })
  }

  async getAllQuickActionChips() {
    return this.page.locator('.overlay-chip-surface')
  }

  getInputField() {
    return this.page.getByRole('textbox')
  }

  async typeInInput(text: string) {
    await this.dismissOverlays()
    const input = this.getInputField()
    await input.fill(text)
    await expect(input).toHaveValue(text)
  }

  async pressEnter() {
    await this.dismissOverlays()
    const input = this.getInputField()
    await input.press('Enter')
  }

  async getChatArea() {
    return this.page.locator('.flex-1.overflow-y-auto').first()
  }

  async getModelSelectorButton() {
    return this.page.getByRole('button', { name: /gemini/i }).first()
  }

  async getShell() {
    return this.page.locator('.overlay-shell-surface')
  }
}
