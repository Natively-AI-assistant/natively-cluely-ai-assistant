/**
 * Tests for audio IPC handlers - language settings, STT config.
 */

import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Create mock instance before vi.mock so it's available in the factory
const mockInstance = {
  setAiResponseLanguage: vi.fn(),
  getSttLanguage: vi.fn(() => 'english-us'),
  getAiResponseLanguage: vi.fn(() => 'auto'),
}

// Mock CredentialsManager - must be hoisted before import
vi.mock('../../../electron/services/CredentialsManager', () => ({
  CredentialsManager: {
    getInstance: vi.fn(() => mockInstance),
  },
}))

import { registerAudioHandlers } from '../../../electron/ipc/ipcHandlers.audio'

// Note: electron is already mocked via tests/electron.setup.ts
// Note: fs and path are already mocked via tests/electron.setup.ts

describe('ipcHandlers.audio - language settings', () => {
  let handlers: Map<string, Function>

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock implementations
    mockInstance.getSttLanguage.mockReturnValue('english-us')
    mockInstance.getAiResponseLanguage.mockReturnValue('auto')
    mockInstance.setAiResponseLanguage.mockClear()
    handlers = new Map()
    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, fn: Function) => {
        handlers.set(channel, fn)
      },
    )
    registerAudioHandlers({} as any)
  })

  it('get-recognition-languages returns language list', async () => {
    const handler = handlers.get('get-recognition-languages')!
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('auto')
    expect(result).toHaveProperty('english-us')
  })

  it('get-ai-response-languages returns language list', async () => {
    const handler = handlers.get('get-ai-response-languages')!
    const result = await handler({} as IpcMainInvokeEvent)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('code')
    expect(result[0]).toHaveProperty('label')
  })

  it('get-stt-language returns stored language', async () => {
    const handler = handlers.get('get-stt-language')!
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toBe('english-us')
  })

  it('set-ai-response-language returns success for valid input', async () => {
    const handler = handlers.get('set-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent, 'English')
    expect(result).toEqual({ success: true })
    expect(mockInstance.setAiResponseLanguage).toHaveBeenCalledWith('English')
  })

  it('set-ai-response-language rejects empty string', async () => {
    const handler = handlers.get('set-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent, '')
    expect(result).toEqual({ success: false, error: 'Invalid language value' })
  })

  it('set-ai-response-language rejects whitespace-only string', async () => {
    const handler = handlers.get('set-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent, '   ')
    expect(result).toEqual({ success: false, error: 'Invalid language value' })
  })

  it('set-ai-response-language rejects null', async () => {
    const handler = handlers.get('set-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent, null as any)
    expect(result).toEqual({ success: false, error: 'Invalid language value' })
  })

  it('set-ai-response-language rejects undefined', async () => {
    const handler = handlers.get('set-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent, undefined as any)
    expect(result).toEqual({ success: false, error: 'Invalid language value' })
  })

  it('set-ai-response-language rejects non-string types', async () => {
    const handler = handlers.get('set-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent, 123 as any)
    expect(result).toEqual({ success: false, error: 'Invalid language value' })
  })

  it('get-ai-response-language returns stored language', async () => {
    const handler = handlers.get('get-ai-response-language')!
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toBe('auto')
  })

  it('set-ai-response-language propagates to LLMHelper when available', async () => {
    const llmHelper = { setAiResponseLanguage: vi.fn() }
    const processingHelper = { getLLMHelper: vi.fn(() => llmHelper) }
    const mockAppState = { processingHelper }

    // Re-register handlers with the appState that has processingHelper
    registerAudioHandlers(mockAppState as any)
    // Get handler AFTER re-registering
    const handler = handlers.get('set-ai-response-language')!
    await handler({} as IpcMainInvokeEvent, 'French')
    expect(llmHelper.setAiResponseLanguage).toHaveBeenCalledWith('French')
  })
})
