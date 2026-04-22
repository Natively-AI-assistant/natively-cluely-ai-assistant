/**
 * Snapshot tests for configuration objects.
 * Catches accidental changes to language configs and settings structures.
 */
import { describe, it, expect } from 'vitest'

describe('Config Snapshots', () => {
  it('recognition languages config matches snapshot', async () => {
    const { RECOGNITION_LANGUAGES } = await import('../../../electron/config/languages')
    expect(RECOGNITION_LANGUAGES).toMatchSnapshot('recognition-languages')
  })

  it('english variants config matches snapshot', async () => {
    const { ENGLISH_VARIANTS } = await import('../../../electron/config/languages')
    expect(ENGLISH_VARIANTS).toMatchSnapshot('english-variants')
  })

  it('AI response languages config matches snapshot', async () => {
    const { AI_RESPONSE_LANGUAGES } = await import('../../../electron/config/languages')
    expect(AI_RESPONSE_LANGUAGES).toMatchSnapshot('ai-response-languages')
  })

  it('default keybinds config matches snapshot', async () => {
    const { DEFAULT_KEYBINDS } = await import('../../../electron/services/KeybindManager')
    expect(DEFAULT_KEYBINDS).toMatchSnapshot('default-keybinds')
  })
})
