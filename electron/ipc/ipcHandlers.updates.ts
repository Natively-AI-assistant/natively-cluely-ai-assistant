/**
 * Auto-update handlers extracted from ipcHandlers.ts.
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';
import { app } from 'electron';

export function registerUpdateHandlers(appState: AppState): void {
  safeHandle("test-release-fetch", async () => {
    try {
      console.log("[IPC] Manual Test Fetch triggered (forcing refresh)...");
      const { ReleaseNotesManager } = require('../update/ReleaseNotesManager');
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes('latest', true);

      if (notes) {
        console.log("[IPC] Notes fetched for:", notes.version);
        const info = {
          version: notes.version || 'latest',
          files: [] as any[],
          path: '',
          sha512: '',
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes
        };
        appState.getMainWindow()?.webContents.send("update-available", info);
        return { success: true };
      }
      return { success: false, error: "No notes returned" };
    } catch (err: any) {
      console.error("[IPC] test-release-fetch failed:", err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("check-for-updates", async () => {
    try {
      console.log('[IPC] Manual update check requested');
      await appState.checkForUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] check-for-updates failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("download-update", async () => {
    try {
      console.log('[IPC] Download update requested');
      appState.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] download-update failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("quit-and-install-update", async () => {
    try {
      console.log('[IPC] Quit and install update requested');
      await appState.quitAndInstallUpdate();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] quit-and-install-update failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("quit-app", () => {
    app.quit();
  });
}
