/**
 * Tests for license IPC handlers - verifying actual handler behavior.
 * Uses dependency injection to mock LicenseManager, allowing tests
 * to run without premium submodule present.
 */

import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseManagerGetter } from '../../../electron/ipc/ipcHandlers.license'
import { registerLicenseHandlers, resetLicenseHandlersCache } from '../../../electron/ipc/ipcHandlers.license'

const mockLicenseManagerInstance: any = vi.hoisted(() => ({
  activateLicense: vi.fn(),
  isPremium: vi.fn(),
  deactivate: vi.fn(),
  getHardwareId: vi.fn(),
  getLicenseDetails: vi.fn(),
  isPremiumAsync: vi.fn(),
}))

const createMockGetLicenseManager = (): LicenseManagerGetter => {
  return async () => ({
    getInstance: () => mockLicenseManagerInstance
  })
}

describe('ipcHandlers.license - handler behavior tests', () => {
  let mockAppState: any
  let handlers: Map<string, (...args: any[]) => Promise<any>>
  let mockGetLm: LicenseManagerGetter

  beforeEach(() => {
    vi.clearAllMocks()
    resetLicenseHandlersCache()

    mockGetLm = createMockGetLicenseManager()

    mockAppState = {
      getKnowledgeOrchestrator: vi.fn(() => ({
        setKnowledgeMode: vi.fn(),
      })),
    }

    handlers = new Map()
    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, fn: (...args: any[]) => Promise<any>) => {
        handlers.set(channel, fn)
      },
    )

    registerLicenseHandlers(mockAppState, mockGetLm)
  })

  describe('license:check-premium', () => {
    it('returns true when user has premium', async () => {
      mockLicenseManagerInstance.isPremium.mockReturnValueOnce(true)

      const handler = handlers.get('license:check-premium')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(true)
      expect(mockLicenseManagerInstance.isPremium).toHaveBeenCalled()
    })

    it('returns false when user does not have premium', async () => {
      mockLicenseManagerInstance.isPremium.mockReturnValueOnce(false)

      const handler = handlers.get('license:check-premium')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })

    it('returns false when LicenseManager throws', async () => {
      mockLicenseManagerInstance.isPremium.mockImplementation(() => {
        throw new Error('LicenseManager not available')
      })

      const handler = handlers.get('license:check-premium')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe(false)
    })
  })

  describe('license:activate', () => {
    it('returns success when activation succeeds', async () => {
      mockLicenseManagerInstance.activateLicense.mockResolvedValueOnce({
        success: true,
      })

      const handler = handlers.get('license:activate')!
      const result = await handler(
        {} as IpcMainInvokeEvent,
        'valid-license-key',
      )

      expect(result.success).toBe(true)
      expect(mockLicenseManagerInstance.activateLicense).toHaveBeenCalledWith(
        'valid-license-key',
      )
    })

    it('returns success false when activation fails', async () => {
      mockLicenseManagerInstance.activateLicense.mockResolvedValueOnce({
        success: false,
        error: 'Invalid license key',
      })

      const handler = handlers.get('license:activate')!
      const result = await handler({} as IpcMainInvokeEvent, 'invalid-key')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid license key')
    })

    it('returns error message when LicenseManager throws', async () => {
      mockLicenseManagerInstance.activateLicense.mockRejectedValueOnce(
        new Error('Not available'),
      )

      const handler = handlers.get('license:activate')!
      const result = await handler({} as IpcMainInvokeEvent, 'any-key')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Premium features not available in this build.')
    })
  })

  describe('license:deactivate', () => {
    it('returns success and disables knowledge mode', async () => {
      const mockOrchestrator = {
        setKnowledgeMode: vi.fn(),
      }
      mockAppState.getKnowledgeOrchestrator.mockReturnValueOnce(
        mockOrchestrator,
      )

      const handler = handlers.get('license:deactivate')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result.success).toBe(true)
      expect(mockLicenseManagerInstance.deactivate).toHaveBeenCalled()
      expect(mockOrchestrator.setKnowledgeMode).toHaveBeenCalledWith(false)
    })

    it('returns success even when orchestrator is not available', async () => {
      mockAppState.getKnowledgeOrchestrator.mockReturnValueOnce(null)

      const handler = handlers.get('license:deactivate')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result.success).toBe(true)
      expect(mockLicenseManagerInstance.deactivate).toHaveBeenCalled()
    })

    it('returns success even when LicenseManager throws', async () => {
      mockLicenseManagerInstance.deactivate.mockImplementationOnce(() => {
        throw new Error('Not available')
      })

      const handler = handlers.get('license:deactivate')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result.success).toBe(true)
    })
  })

  describe('license:get-hardware-id', () => {
    it('returns hardware id when available', async () => {
      mockLicenseManagerInstance.getHardwareId.mockReturnValueOnce(
        'HW-12345-ABCDE',
      )

      const handler = handlers.get('license:get-hardware-id')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe('HW-12345-ABCDE')
      expect(mockLicenseManagerInstance.getHardwareId).toHaveBeenCalled()
    })

    it('returns unavailable when LicenseManager throws', async () => {
      mockLicenseManagerInstance.getHardwareId.mockImplementationOnce(() => {
        throw new Error('Not available')
      })

      const handler = handlers.get('license:get-hardware-id')!
      const result = await handler({} as IpcMainInvokeEvent)

      expect(result).toBe('unavailable')
    })
  })
})
