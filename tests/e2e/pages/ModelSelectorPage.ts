import { Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class ModelSelectorPage extends BasePage {
  constructor(public page: Page) {
    super(page)
  }

  async goto() {
    await this.dismissOverlays()
    await this.page.goto('/?window=model-selector')
    await expect(this.page.locator('body')).toBeVisible({ timeout: 10000 })
  }

  async getModelButtons() {
    return this.page.getByRole('button')
  }

  async getNoModelsMessage() {
    return this.page.getByText(/no models/i)
  }

  async getLoadingMessage() {
    return this.page.getByText(/loading/i)
  }

  async hasSelectElements() {
    const count = await this.page.locator('select').count()
    return count > 0
  }

  async hasOptionElements() {
    const count = await this.page.locator('option').count()
    return count > 0
  }

  async clickModel(name: string) {
    await this.dismissOverlays()
    await this.page.getByRole('button', { name }).click()
  }
}
