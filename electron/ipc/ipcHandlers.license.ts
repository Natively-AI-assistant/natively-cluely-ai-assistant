/**
 * License handlers extracted from ipcHandlers.ts.
 */

import type { AppState } from '../main'
import { safeHandle } from './safeHandle'

export type LicenseManagerGetter = () => Promise<any | null>

let _LicenseManager: any

async function defaultGetLicenseManager(): Promise<any | null> {
  if (_LicenseManager === undefined) {
    try {
      const module = await import(
        '../../premium/electron/services/LicenseManager'
      )
      _LicenseManager = module.LicenseManager
    } catch {
      _LicenseManager = null
    }
  }
  return _LicenseManager
}

export function resetLicenseHandlersCache(): void {
  _LicenseManager = undefined
}

export function registerLicenseHandlers(
  appState: AppState,
  getLm: LicenseManagerGetter = defaultGetLicenseManager,
): void {
  safeHandle('license:activate', async (event, key: string) => {
    try {
      const LicenseManager = await getLm()
      if (!LicenseManager) {
        return {
          success: false,
          error: 'Premium features not available in this build.',
        }
      }
      return await LicenseManager.getInstance().activateLicense(key)
    } catch (err: any) {
      console.error('[IPC] license:activate unexpected error:', err)
      return {
        success: false,
        error: 'Premium features not available in this build.',
      }
    }
  })

  safeHandle('license:check-premium', async () => {
    try {
      const LicenseManager = await getLm()
      if (!LicenseManager) return false
      return LicenseManager.getInstance().isPremium()
    } catch {
      return false
    }
  })

  safeHandle('license:deactivate', async () => {
    try {
      const LicenseManager = await getLm()
      if (LicenseManager) {
        LicenseManager.getInstance().deactivate()
      }
      try {
        const orchestrator = appState.getKnowledgeOrchestrator()
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false)
          console.log(
            '[IPC] Knowledge mode auto-disabled due to license deactivation',
          )
        }
      } catch {
        /* ignore */
      }
    } catch {
      /* LicenseManager not available */
    }
    return { success: true }
  })

  safeHandle('license:get-hardware-id', async () => {
    try {
      const LicenseManager = await getLm()
      if (!LicenseManager) return 'unavailable'
      return LicenseManager.getInstance().getHardwareId()
    } catch {
      return 'unavailable'
    }
  })

  safeHandle('license:get-details', async () => {
    try {
      const LicenseManager = await getLm()
      if (!LicenseManager) return { isPremium: false }
      return LicenseManager.getInstance().getLicenseDetails()
    } catch {
      return { isPremium: false }
    }
  })

  safeHandle('license:check-premium-async', async () => {
    try {
      const LicenseManager = await getLm()
      if (!LicenseManager) return false
      return await LicenseManager.getInstance().isPremiumAsync()
    } catch {
      return false
    }
  })
}
