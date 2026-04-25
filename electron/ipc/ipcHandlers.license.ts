/**
 * License handlers extracted from ipcHandlers.ts.
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';
import { app } from 'electron';
import { LicenseManager } from '../../premium/electron/services/LicenseManager';

export function registerLicenseHandlers(appState: AppState): void {
  safeHandle("license:activate", async (event, key: string) => {
    try {
      return await LicenseManager.getInstance().activateLicense(key);
    } catch (err: any) {
      console.error('[IPC] license:activate unexpected error:', err);
      return { success: false, error: 'Premium features not available in this build.' };
    }
  });

  safeHandle("license:check-premium", async () => {
    try {
      return LicenseManager.getInstance().isPremium();
    } catch {
      return false;
    }
  });

  safeHandle("license:deactivate", async () => {
    try {
      LicenseManager.getInstance().deactivate();
      // Auto-disable knowledge mode when license is removed
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          console.log('[IPC] Knowledge mode auto-disabled due to license deactivation');
        }
      } catch { /* ignore */ }
    } catch { /* LicenseManager not available */ }
    return { success: true };
  });

  safeHandle("license:get-hardware-id", async () => {
    try {
      return LicenseManager.getInstance().getHardwareId();
    } catch {
      return 'unavailable';
    }
  });

  safeHandle("license:get-details", async () => {
    try {
      return LicenseManager.getInstance().getLicenseDetails();
    } catch {
      return { isPremium: false };
    }
  });

  safeHandle("license:check-premium-async", async () => {
    try {
      return await LicenseManager.getInstance().isPremiumAsync();
    } catch {
      return false;
    }
  });
}
