/**
 * Tests for meeting IPC handlers - verifying actual handler behavior.
 *
 * ECORE-04 Gap: Previous tests only verified handlers were registered with ipcMain.handle,
 * not that invoking them produces correct results.
 */

import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMeetingHandlers } from '../../../electron/ipc/ipcHandlers.meeting'

describe('ipcHandlers.meeting - handler behavior tests', () => {
  let mockAppState: any
  let handlers: Map<string, Function>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create persistent mock windowHelper
    const mockWindowHelper = {
      showOverlay: vi.fn(),
      hideOverlay: vi.fn(),
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      isMainWindowMaximized: vi.fn(() => false),
      setWindowMode: vi.fn(),
    }

    mockAppState = {
      getIsMeetingActive: vi.fn(() => false),
      deleteScreenshot: vi.fn(() => Promise.resolve({ success: true })),
      takeScreenshot: vi.fn(() => Promise.resolve('/tmp/screenshot.png')),
      takeSelectiveScreenshot: vi.fn(() =>
        Promise.resolve('/tmp/selective.png'),
      ),
      getImagePreview: vi.fn(() => Promise.resolve('base64...')),
      getScreenshotQueue: vi.fn(() => []),
      getExtraScreenshotQueue: vi.fn(() => []),
      getView: vi.fn(() => 'queue'),
      toggleMainWindow: vi.fn(),
      showMainWindow: vi.fn(),
      hideMainWindow: vi.fn(),
      clearQueues: vi.fn(),
      finalizeMicSTT: vi.fn(),
      moveWindowLeft: vi.fn(),
      moveWindowRight: vi.fn(),
      moveWindowUp: vi.fn(),
      moveWindowDown: vi.fn(),
      centerAndShowWindow: vi.fn(),
      getWindowHelper: vi.fn(() => mockWindowHelper),
      settingsWindowHelper: {
        getSettingsWindow: vi.fn(() => null),
        setWindowDimensions: vi.fn(),
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
    registerMeetingHandlers(mockAppState)
  })

  describe('get-meeting-active', () => {
    it('returns false when meeting is not active', async () => {
      const handler = handlers.get('get-meeting-active')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })

    it('returns true when meeting is active', async () => {
      mockAppState.getIsMeetingActive.mockReturnValueOnce(true)

      const handler = handlers.get('get-meeting-active')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(true)
    })

    it('calls getIsMeetingActive on appState', async () => {
      const handler = handlers.get('get-meeting-active')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.getIsMeetingActive).toHaveBeenCalled()
    })
  })

  describe('toggle-window', () => {
    it('calls toggleMainWindow on appState', async () => {
      const handler = handlers.get('toggle-window')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.toggleMainWindow).toHaveBeenCalled()
    })
  })

  describe('show-window', () => {
    it('calls showMainWindow on appState', async () => {
      const handler = handlers.get('show-window')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.showMainWindow).toHaveBeenCalled()
    })

    it('show-window accepts inactive parameter', async () => {
      const handler = handlers.get('show-window')!
      await handler({} as IpcMainInvokeEvent, true)

      expect(mockAppState.showMainWindow).toHaveBeenCalledWith(true)
    })
  })

  describe('hide-window', () => {
    it('calls hideMainWindow on appState', async () => {
      const handler = handlers.get('hide-window')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.hideMainWindow).toHaveBeenCalled()
    })
  })

  describe('reset-queues', () => {
    it('returns success after clearing queues', async () => {
      const handler = handlers.get('reset-queues')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toEqual({ success: true })
    })

    it('calls clearQueues on appState', async () => {
      const handler = handlers.get('reset-queues')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.clearQueues).toHaveBeenCalled()
    })
  })

  describe('window movement handlers', () => {
    it('move-window-left calls moveWindowLeft', async () => {
      const handler = handlers.get('move-window-left')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.moveWindowLeft).toHaveBeenCalled()
    })

    it('move-window-right calls moveWindowRight', async () => {
      const handler = handlers.get('move-window-right')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.moveWindowRight).toHaveBeenCalled()
    })

    it('move-window-up calls moveWindowUp', async () => {
      const handler = handlers.get('move-window-up')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.moveWindowUp).toHaveBeenCalled()
    })

    it('move-window-down calls moveWindowDown', async () => {
      const handler = handlers.get('move-window-down')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.moveWindowDown).toHaveBeenCalled()
    })
  })

  describe('center-and-show-window', () => {
    it('calls centerAndShowWindow on appState', async () => {
      const handler = handlers.get('center-and-show-window')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.centerAndShowWindow).toHaveBeenCalled()
    })
  })

  describe('window controls', () => {
    it('window-minimize calls minimizeWindow on windowHelper', async () => {
      const handler = handlers.get('window-minimize')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.getWindowHelper()).toBeDefined()
      const windowHelper = mockAppState.getWindowHelper()
      expect(windowHelper.minimizeWindow).toHaveBeenCalled()
    })

    it('window-maximize calls maximizeWindow on windowHelper', async () => {
      const handler = handlers.get('window-maximize')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.getWindowHelper()).toBeDefined()
      const windowHelper = mockAppState.getWindowHelper()
      expect(windowHelper.maximizeWindow).toHaveBeenCalled()
    })

    it('window-close calls closeWindow on windowHelper', async () => {
      const handler = handlers.get('window-close')!
      await handler({} as IpcMainInvokeEvent)

      expect(mockAppState.getWindowHelper()).toBeDefined()
      const windowHelper = mockAppState.getWindowHelper()
      expect(windowHelper.closeWindow).toHaveBeenCalled()
    })

    it('window-is-maximized returns window state', async () => {
      const handler = handlers.get('window-is-maximized')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })
  })
})
