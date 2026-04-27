/**
 * Self-tests for the ElectronAPI mock factory.
 *
 * Verifies completeness, default return values, override merging,
 * reset behaviour, and window.electronAPI installation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Import shared fixtures as source of truth for credential defaults
import { mockCredentials } from '../fixtures'
import {
  createElectronAPIMock,
  getExpectedElectronAPIMethods,
  installElectronAPIMock,
  resetElectronAPIMock,
} from './electronAPI.mock'

// ---------------------------------------------------------------------------
// 1. Completeness — every interface method is present
// ---------------------------------------------------------------------------
describe('createElectronAPIMock', () => {
  it('returns an object with every method from the ElectronAPI interface', () => {
    const mock = createElectronAPIMock()
    const expected = getExpectedElectronAPIMethods()

    const missing = expected.filter((key) => !(key in mock))
    expect(missing).toEqual([])

    const extra = Object.keys(mock).filter((key) => !expected.includes(key))
    expect(extra).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // 2. Each method is a vi.fn() with sensible defaults
  // ---------------------------------------------------------------------------
  it('every async get* method returns a Promise resolving to a type-appropriate default', async () => {
    const mock = createElectronAPIMock()

    // Boolean getters
    expect(await mock.windowIsMaximized()).toBe(false)
    expect(await mock.getMeetingActive()).toBe(false)
    expect(await mock.getOverlayMousePassthrough()).toBe(false)
    expect(await mock.getVerboseLogging()).toBe(false)
    expect(await mock.getOpenAtLogin()).toBe(false)
    expect(await mock.getUndetectable()).toBe(false)

    // String getters
    expect(await mock.getSttProvider()).toBe('google')
    expect(await mock.getArch()).toBe('')
    expect(await mock.getDisguise()).toBe('none')

    // Array getters
    expect(await mock.getScreenshots()).toEqual([])
    expect(await mock.getAvailableOllamaModels()).toEqual([])
    expect(await mock.getInputDevices()).toEqual([])
    expect(await mock.getRecentMeetings()).toEqual([])
    expect(await mock.getKeybinds()).toEqual([])
    expect(await mock.getCustomProviders()).toEqual([])

    // Object getters
    expect(await mock.getRecognitionLanguages()).toEqual({})
    expect(await mock.getMeetingDetails()).toEqual({})
    expect(await mock.profileGetProfile()).toEqual({})
    expect(await mock.getStoredCredentials()).toMatchObject({
      hasGeminiKey: mockCredentials.hasGeminiKey,
      sttProvider: mockCredentials.sttProvider,
    })
    expect(await mock.getCurrentLlmConfig()).toEqual({
      provider: 'ollama',
      model: '',
      isOllama: true,
    })
  })

  it('every set* and test* method resolves to { success: true }', async () => {
    const mock = createElectronAPIMock()

    // Sampling — not exhaustive, but covers every category
    expect(await mock.setGeminiApiKey('key')).toEqual({ success: true })
    expect(await mock.setSttProvider('google')).toEqual({ success: true })
    expect(await mock.setRecognitionLanguage('en')).toEqual({ success: true })
    expect(await mock.setModel('gpt-4')).toEqual({ success: true })
    expect(await mock.setGroqFastTextMode(true)).toEqual({ success: true })
    expect(await mock.setVerboseLogging(true)).toEqual({ success: true })
    expect(await mock.setTavilyApiKey('key')).toEqual({ success: true })

    expect(await mock.testLlmConnection('gemini')).toEqual({ success: true })
    expect(await mock.testSttConnection('groq', 'key')).toEqual({
      success: true,
    })
    expect(await mock.testReleaseFetch()).toEqual({ success: true })
  })

  it('every on* listener is a vi.fn that returns an unsubscribe function', () => {
    const mock = createElectronAPIMock()
    const listenerNames = Object.keys(mock).filter((k) => k.startsWith('on'))

    expect(listenerNames.length).toBeGreaterThan(50) // sanity: we have 60+ listeners

    for (const name of listenerNames) {
      const fn = mock[name]
      expect(vi.isMockFunction(fn)).toBe(true)
      // Call it — should return a function (the unsubscribe)
      const unsub = fn(() => {})
      expect(typeof unsub).toBe('function')
    }
  })

  it('void async methods resolve to undefined', async () => {
    const mock = createElectronAPIMock()

    expect(
      await mock.updateContentDimensions({ width: 100, height: 100 }),
    ).toBeUndefined()
    expect(await mock.takeScreenshot()).toBeUndefined()
    expect(await mock.moveWindowLeft()).toBeUndefined()
    expect(await mock.quitApp()).toBeUndefined()
    expect(await mock.showWindow()).toBeUndefined()
    expect(await mock.hideWindow()).toBeUndefined()
    expect(await mock.showOverlay()).toBeUndefined()
    expect(await mock.hideOverlay()).toBeUndefined()
    expect(await mock.streamGeminiChat('hello')).toBeUndefined()
    expect(await mock.restartAndInstall()).toBeUndefined()
  })

  it('platform is a string', () => {
    const mock = createElectronAPIMock()
    expect(typeof mock.platform).toBe('string')
  })

  it('fire-and-forget cropper methods are vi.fn with no default return', () => {
    const mock = createElectronAPIMock()
    expect(vi.isMockFunction(mock.cropperConfirmed)).toBe(true)
    expect(vi.isMockFunction(mock.cropperCancelled)).toBe(true)
    // They should not throw when called
    expect(() =>
      mock.cropperConfirmed({ x: 0, y: 0, width: 100, height: 100 }),
    ).not.toThrow()
    expect(() => mock.cropperCancelled()).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // 3. Overrides merge correctly
  // ---------------------------------------------------------------------------
  it('createElectronAPIMock(overrides) merges overrides for per-test customization', () => {
    const customImpl = vi.fn(() => Promise.resolve(true))
    const mock = createElectronAPIMock({
      windowIsMaximized: customImpl,
      platform: 'darwin',
    })

    // Overridden values
    expect(mock.windowIsMaximized).toBe(customImpl)
    expect(mock.platform).toBe('darwin')

    // Non-overridden values remain defaults
    expect(vi.isMockFunction(mock.getMeetingActive)).toBe(true)
    expect(mock.platform).not.toBe('linux')
  })

  it('overrides can replace listener with custom implementation', () => {
    const calls: any[] = []
    const customListener = vi.fn((cb: any) => {
      calls.push(cb)
      return () => {
        /* custom unsub */
      }
    })

    const mock = createElectronAPIMock({ onScreenshotTaken: customListener })
    const unsub = mock.onScreenshotTaken(() => {})

    expect(customListener).toHaveBeenCalledTimes(1)
    expect(typeof unsub).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 4. resetElectronAPIMock clears call history
// ---------------------------------------------------------------------------
describe('resetElectronAPIMock', () => {
  beforeEach(() => {
    installElectronAPIMock()
  })

  afterEach(() => {
    // Clean up
    vi.restoreAllMocks()
  })

  it('clears all vi.fn() call history on the installed mock', () => {
    const api = (window as any).electronAPI

    // Make some calls
    api.takeScreenshot()
    api.onScreenshotTaken(() => {})
    api.setGeminiApiKey('test')

    expect(api.takeScreenshot).toHaveBeenCalledTimes(1)
    expect(api.onScreenshotTaken).toHaveBeenCalledTimes(1)
    expect(api.setGeminiApiKey).toHaveBeenCalledTimes(1)

    // Reset
    resetElectronAPIMock()

    // All cleared
    expect(api.takeScreenshot).toHaveBeenCalledTimes(0)
    expect(api.onScreenshotTaken).toHaveBeenCalledTimes(0)
    expect(api.setGeminiApiKey).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// 5. installElectronAPIMock assigns to window.electronAPI
// ---------------------------------------------------------------------------
describe('installElectronAPIMock', () => {
  it('assigns the mock to window.electronAPI for renderer tests', () => {
    const api = installElectronAPIMock()

    expect(window.electronAPI).toBe(api)
    expect(vi.isMockFunction(api.takeScreenshot)).toBe(true)
    expect(api.platform).toBe('linux')
  })

  it('accepts overrides during installation', () => {
    const api = installElectronAPIMock({ platform: 'win32' })

    expect(api.platform).toBe('win32')
    expect(window.electronAPI).toBe(api)
  })

  it('replaces the mock when called a second time', () => {
    const first = installElectronAPIMock()
    const second = installElectronAPIMock({ platform: 'darwin' })

    expect(window.electronAPI).toBe(second)
    expect(window.electronAPI).not.toBe(first)
    expect(second.platform).toBe('darwin')
  })
})
