import { Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

interface CropperWindow extends Window {
  __cropperResetCallback?: (data: { hudPosition: { x: number; y: number } }) => void
}

export class CropperPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  async goto() {
    await this.dismissOverlays()
    await this.page.goto('/?window=cropper')
    await expect(this.page.locator('canvas')).toBeVisible({ timeout: 10000 })
  }

  getCanvas() {
    return this.page.locator('canvas')
  }

  async getCanvasDimensions() {
    const canvas = this.getCanvas()
    const box = await canvas.boundingBox()
    return { width: box?.width ?? 0, height: box?.height ?? 0 }
  }

  async getHudPill() {
    return this.page.getByText('Select area', { exact: true })
  }

  async triggerIpcReset() {
    await this.dismissOverlays()
    await this.page.evaluate(() => {
      ;(window as CropperWindow).__cropperResetCallback?.({
        hudPosition: { x: 640, y: 360 }
      })
    })
  }

  async pressEscape() {
    await this.dismissOverlays()
    await this.page.keyboard.press('Escape')
  }

  async getBodyElementCount() {
    return this.page.locator('body *').count()
  }
}
