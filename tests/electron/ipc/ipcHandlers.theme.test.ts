/**
 * Tests for theme IPC handlers - verifying actual handler behavior.
 */

import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerThemeHandlers } from '../../../electron/ipc/ipcHandlers.theme'

describe('ipcHandlers.theme - handler behavior tests', () => {
  let mockAppState: any
  let handlers: Map<string, Function>
  let mockThemeManager: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockThemeManager = {
      getMode: vi.fn(() => 'system'),
      getResolvedTheme: vi.fn(() => 'light'),
      setMode: vi.fn(),
    }

    mockAppState = {
      getThemeManager: vi.fn(() => mockThemeManager),
    }

    // Capture registered handlers
    handlers = new Map()
    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, fn: Function) => {
        handlers.set(channel, fn)
      },
    )

    // Register handlers
    registerThemeHandlers(mockAppState)
  })

  describe('theme:get-mode', () => {
    it('returns current theme config with mode and resolved properties', async () => {
      mockThemeManager.getMode.mockReturnValueOnce('system')
      mockThemeManager.getResolvedTheme.mockReturnValueOnce('light')

      const handler = handlers.get('theme:get-mode')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toEqual({
        mode: 'system',
        resolved: 'light',
      })
    })

    it('returns dark resolved theme when in dark mode', async () => {
      mockThemeManager.getMode.mockReturnValueOnce('dark')
      mockThemeManager.getResolvedTheme.mockReturnValueOnce('dark')

      const handler = handlers.get('theme:get-mode')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toEqual({
        mode: 'dark',
        resolved: 'dark',
      })
    })

    it('returns light mode with light resolved theme', async () => {
      mockThemeManager.getMode.mockReturnValueOnce('light')
      mockThemeManager.getResolvedTheme.mockReturnValueOnce('light')

      const handler = handlers.get('theme:get-mode')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toEqual({
        mode: 'light',
        resolved: 'light',
      })
    })

    it('calls getThemeManager to access theme manager', async () => {
      const handler = handlers.get('theme:get-mode')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.getThemeManager).toHaveBeenCalled()
    })
  })

  describe('theme:set-mode', () => {
    it('calls appState.getThemeManager().setMode with system', async () => {
      const handler = handlers.get('theme:set-mode')!
      const result = await handler({} as IpcMainInvokeEvent, 'system')

      expect(mockThemeManager.setMode).toHaveBeenCalledWith('system')
      expect(result).toEqual({ success: true })
    })

    it('calls appState.getThemeManager().setMode with light', async () => {
      const handler = handlers.get('theme:set-mode')!
      const result = await handler({} as IpcMainInvokeEvent, 'light')

      expect(mockThemeManager.setMode).toHaveBeenCalledWith('light')
      expect(result).toEqual({ success: true })
    })

    it('calls appState.getThemeManager().setMode with dark', async () => {
      const handler = handlers.get('theme:set-mode')!
      const result = await handler({} as IpcMainInvokeEvent, 'dark')

      expect(mockThemeManager.setMode).toHaveBeenCalledWith('dark')
      expect(result).toEqual({ success: true })
    })

    it('rejects invalid string mode "invalid"', async () => {
      const handler = handlers.get('theme:set-mode')!

      await expect(async () =>
        handler({} as IpcMainInvokeEvent, 'invalid'),
      ).rejects.toThrow()
    })

    it('rejects null as mode value', async () => {
      const handler = handlers.get('theme:set-mode')!

      await expect(async () =>
        handler({} as IpcMainInvokeEvent, null),
      ).rejects.toThrow()
    })

    it('rejects undefined as mode value', async () => {
      const handler = handlers.get('theme:set-mode')!

      await expect(async () =>
        handler({} as IpcMainInvokeEvent, undefined),
      ).rejects.toThrow()
    })
  })
})
