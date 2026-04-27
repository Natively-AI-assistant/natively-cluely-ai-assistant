import { expect, test } from '../fixtures/test'

test.describe('Cropper', () => {
  test('renders cropper with canvas', async ({ cropper }) => {
    await cropper.goto()

    await expect(cropper.getCanvas()).toBeVisible()
  })

  test('canvas has non-zero dimensions', async ({ cropper }) => {
    await cropper.goto()

    const { width, height } = await cropper.getCanvasDimensions()

    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })

  test('renders without crash', async ({ cropper }) => {
    await cropper.goto()

    const count = await cropper.getBodyElementCount()

    expect(count).toBeGreaterThan(0)
  })

  test('shows HUD pill after IPC reset', async ({ cropper }) => {
    await cropper.goto()

    await cropper.triggerIpcReset()

    await expect(await cropper.getHudPill()).toBeVisible()
  })

  test('closes on Escape key', async ({ cropper }) => {
    await cropper.goto()

    await cropper.pressEscape()

    await expect(cropper.getCanvas()).not.toBeVisible()
  })
})
