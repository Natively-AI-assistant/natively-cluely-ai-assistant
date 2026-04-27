/**
 * Tests for settings IPC handlers - verifying actual handler behavior.
 *
 * ECORE-04 Gap: Previous tests only verified handlers were registered with ipcMain.handle,
 * not that invoking them produces correct results.
 */

import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSettingsHandlers } from '../../../electron/ipc/ipcHandlers.settings'

describe('ipcHandlers.settings - handler behavior tests', () => {
  let mockAppState: any
  let handlers: Map<string, Function>

  beforeEach(() => {
    vi.clearAllMocks()

    mockAppState = {
      setUndetectable: vi.fn(),
      getUndetectable: vi.fn(() => false),
      setDisguise: vi.fn(),
      getDisguise: vi.fn(() => 'none'),
      setOverlayMousePassthrough: vi.fn(),
      toggleOverlayMousePassthrough: vi.fn(() => true),
      getOverlayMousePassthrough: vi.fn(() => false),
      setVerboseLogging: vi.fn(),
      getVerboseLogging: vi.fn(() => false),
      settingsWindowHelper: {
        toggleWindow: vi.fn(),
        closeWindow: vi.fn(),
        getSettingsWindow: vi.fn(() => null),
      },
    }

    // Capture registered handlers
    handlers = new Map()
    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, fn: Function) => {
        handlers.set(channel, fn)
      },
    )

    // Register handlers
    registerSettingsHandlers(mockAppState)
  })

  describe('set-undetectable', () => {
    it('sets undetectable state to true', async () => {
      const handler = handlers.get('set-undetectable')!
      await handler({} as IpcMainInvokeEvent, true)

      expect(mockAppState.setUndetectable).toHaveBeenCalledWith(true)
    })

    it('sets undetectable state to false', async () => {
      const handler = handlers.get('set-undetectable')!
      await handler({} as IpcMainInvokeEvent, false)

      expect(mockAppState.setUndetectable).toHaveBeenCalledWith(false)
    })
  })

  describe('get-undetectable', () => {
    it('returns current undetectable state', async () => {
      mockAppState.getUndetectable.mockReturnValueOnce(true)

      const handler = handlers.get('get-undetectable')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(true)
    })

    it('returns false when not undetectable', async () => {
      const handler = handlers.get('get-undetectable')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })
  })

  describe('set-disguise', () => {
    it('sets disguise mode', async () => {
      const handler = handlers.get('set-disguise')!
      await handler({} as IpcMainInvokeEvent, 'terminal')

      expect(mockAppState.setDisguise).toHaveBeenCalledWith('terminal')
    })

    it('sets disguise mode to settings', async () => {
      const handler = handlers.get('set-disguise')!
      await handler({} as IpcMainInvokeEvent, 'settings')

      expect(mockAppState.setDisguise).toHaveBeenCalledWith('settings')
    })

    it('sets disguise mode to activity', async () => {
      const handler = handlers.get('set-disguise')!
      await handler({} as IpcMainInvokeEvent, 'activity')

      expect(mockAppState.setDisguise).toHaveBeenCalledWith('activity')
    })

    it('sets disguise mode to none', async () => {
      const handler = handlers.get('set-disguise')!
      await handler({} as IpcMainInvokeEvent, 'none')

      expect(mockAppState.setDisguise).toHaveBeenCalledWith('none')
    })
  })

  describe('get-disguise', () => {
    it('returns current disguise mode', async () => {
      mockAppState.getDisguise.mockReturnValueOnce('terminal')

      const handler = handlers.get('get-disguise')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe('terminal')
    })

    it('returns none by default', async () => {
      const handler = handlers.get('get-disguise')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe('none')
    })
  })

  describe('toggle-overlay-mouse-passthrough', () => {
    it('toggles passthrough state and returns result', async () => {
      const handler = handlers.get('toggle-overlay-mouse-passthrough')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.toggleOverlayMousePassthrough).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.enabled).toBe(true)
    })
  })

  describe('get-overlay-mouse-passthrough', () => {
    it('returns current passthrough state', async () => {
      mockAppState.getOverlayMousePassthrough.mockReturnValueOnce(true)

      const handler = handlers.get('get-overlay-mouse-passthrough')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(true)
    })

    it('returns false by default', async () => {
      const handler = handlers.get('get-overlay-mouse-passthrough')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })
  })

  describe('set-verbose-logging', () => {
    it('sets verbose logging to true', async () => {
      const handler = handlers.get('set-verbose-logging')!
      await handler({} as IpcMainInvokeEvent, true)

      expect(mockAppState.setVerboseLogging).toHaveBeenCalledWith(true)
    })

    it('sets verbose logging to false', async () => {
      const handler = handlers.get('set-verbose-logging')!
      await handler({} as IpcMainInvokeEvent, false)

      expect(mockAppState.setVerboseLogging).toHaveBeenCalledWith(false)
    })
  })

  describe('get-verbose-logging', () => {
    it('returns current verbose logging state', async () => {
      mockAppState.getVerboseLogging.mockReturnValueOnce(true)

      const handler = handlers.get('get-verbose-logging')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(true)
    })

    it('returns false by default', async () => {
      const handler = handlers.get('get-verbose-logging')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })
  })

  describe('toggle-settings-window', () => {
    it('toggles settings window', async () => {
      const handler = handlers.get('toggle-settings-window')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.settingsWindowHelper.toggleWindow).toHaveBeenCalled()
    })
  })
})
