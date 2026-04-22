/**
 * Meeting handlers extracted from ipcHandlers.ts.
 * Handles meeting lifecycle, screenshots, window control.
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';
import { app } from 'electron';
import * as path from 'path';

export function registerMeetingHandlers(appState: AppState): void {
  safeHandle("get-meeting-active", async () => {
    return appState.getIsMeetingActive();
  });

  safeHandle("delete-screenshot", async (_, filePath: string) => {
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    return appState.deleteScreenshot(resolved);
  });

  safeHandle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      throw error;
    }
  });

  safeHandle("take-selective-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeSelectiveScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      if ((error as Error).message === "Selection cancelled") {
        return { cancelled: true };
      }
      throw error;
    }
  });

  safeHandle("get-screenshots", async () => {
    try {
      let previews = [];
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        );
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        );
      }
      return previews;
    } catch (error) {
      throw error;
    }
  });

  safeHandle("toggle-window", async () => {
    appState.toggleMainWindow();
  });

  safeHandle("show-window", async (event, inactive?: boolean) => {
    appState.showMainWindow(inactive);
  });

  safeHandle("hide-window", async () => {
    appState.hideMainWindow();
  });

  safeHandle("show-overlay", async () => {
    appState.getWindowHelper().showOverlay();
  });

  safeHandle("hide-overlay", async () => {
    appState.getWindowHelper().hideOverlay();
  });

  safeHandle("reset-queues", async () => {
    try {
      appState.clearQueues();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("finalize-mic-stt", async () => {
    appState.finalizeMicSTT();
  });

  // Window movement handlers
  safeHandle("move-window-left", async () => {
    appState.moveWindowLeft();
  });

  safeHandle("move-window-right", async () => {
    appState.moveWindowRight();
  });

  safeHandle("move-window-up", async () => {
    appState.moveWindowUp();
  });

  safeHandle("move-window-down", async () => {
    appState.moveWindowDown();
  });

  safeHandle("center-and-show-window", async () => {
    appState.centerAndShowWindow();
  });

  // Window Controls
  safeHandle("window-minimize", async () => {
    appState.getWindowHelper().minimizeWindow();
  });

  safeHandle("window-maximize", async () => {
    appState.getWindowHelper().maximizeWindow();
  });

  safeHandle("window-close", async () => {
    appState.getWindowHelper().closeWindow();
  });

  safeHandle("window-is-maximized", async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });

  // Content dimensions
  safeHandle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;

      const senderWebContents = event.sender;
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow();
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      const launcherWin = appState.getWindowHelper().getLauncherWindow();

      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height);
      } else if (
        overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === senderWebContents.id
      ) {
        appState.getWindowHelper().setOverlayDimensions(width, height);
      } else if (
        launcherWin && !launcherWin.isDestroyed() && launcherWin.webContents.id === senderWebContents.id
      ) {
        console.log(`[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored — launcher has fixed dimensions)`);
      }
    }
  );

  safeHandle("set-window-mode", async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  });

  safeHandle("get-recent-meetings", async () => {
    const { DatabaseManager } = require('../db/DatabaseManager');
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle("seed-demo", async () => {
    const { DatabaseManager } = require('../db/DatabaseManager');
    DatabaseManager.getInstance().seedDemoMeeting();
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }
    return { success: true };
  });

  safeHandle("flush-database", async () => {
    const { DatabaseManager } = require('../db/DatabaseManager');
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  safeHandle("get-calendar-status", async () => {
    try {
      const { CalendarManager } = require('../services/CalendarManager');
      return { connected: CalendarManager.getInstance().isConnected() };
    } catch {
      return { connected: false };
    }
  });

  safeHandle("get-upcoming-events", async () => {
    try {
      const { CalendarManager } = require('../services/CalendarManager');
      return await CalendarManager.getInstance().getUpcomingEvents();
    } catch {
      return [];
    }
  });

  safeHandle("start-meeting", async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("start-audio-test", async (event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle("native-audio-status", async () => {
    return { connected: true };
  });

  safeHandle("toggle-model-selector", async (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
    return { success: true };
  });

  safeHandle("show-model-selector", async (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
    return { success: true };
  });

  safeHandle("hide-model-selector", async () => {
    appState.modelSelectorWindowHelper.hideWindow();
    return { success: true };
  });

  safeHandle("submit-manual-question", async (_, question: string) => {
    const intManager = appState.getIntelligenceManager();
    const result = await intManager.runManualAnswer(question);
    return { answer: result, question };
  });

  safeHandle("update-meeting-title", async (_, { id, title }: { id: string; title: string }) => {
    const { DatabaseManager } = require('../db/DatabaseManager');
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle("update-meeting-summary", async (_, { id, updates }: { id: string; updates: any }) => {
    const { DatabaseManager } = require('../db/DatabaseManager');
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle("open-external", async (event, url: string) => {
    const { shell } = require('electron');
    const parsedUrl = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
      return { success: false, error: 'Protocol not allowed' };
    }
    await shell.openExternal(url);
    return { success: true };
  });

  safeHandle("open-mailto", async (_, { to, subject, body }: { to: string; subject: string; body: string }) => {
    try {
      const { shell } = require('electron');
      const { buildMailtoLink } = require('../utils/emailUtils');
      const mailtoLink = buildMailtoLink(to, subject, body);
      await shell.openExternal(mailtoLink);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-overlay-opacity", async (_, opacity: number) => {
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    const { BrowserWindow } = require('electron') as typeof import('electron');
    (BrowserWindow.getAllWindows() as any).forEach((win: any) => {
      if (!win.isDestroyed()) win.webContents.send('overlay-opacity-changed', clamped);
    });
    return { success: true };
  });

  safeHandle("calendar-connect", async () => {
    try {
      const { CalendarManager } = require('../services/CalendarManager');
      await CalendarManager.getInstance().startAuthFlow();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("calendar-disconnect", async () => {
    try {
      const { CalendarManager } = require('../services/CalendarManager');
      CalendarManager.getInstance().disconnect();
      return { success: true };
    } catch {
      return { success: true };
    }
  });

  safeHandle("calendar-refresh", async () => {
    try {
      const { CalendarManager } = require('../services/CalendarManager');
      await CalendarManager.getInstance().refresh();
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  safeHandle("get-calendar-attendees", async (_, eventId: string) => {
    const { CalendarManager } = require('../services/CalendarManager');
    const events = await CalendarManager.getInstance().getUpcomingEvents();
    const event = events?.find((e: any) => e.id === eventId);
    if (event && event.attendees) {
      return event.attendees.map((a: any) => ({
        email: a.email,
        name: a.displayName || a.email?.split('@')[0] || ''
      })).filter((a: any) => a.email);
    }
    return [];
  });

  safeHandle("select-service-account", async () => {
    const { dialog } = require('electron');
    try {
      const result: any = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled || result.filePaths.length === 0) return { success: false, cancelled: true };
      const filePath = result.filePaths[0];
      appState.updateGoogleCredentials(filePath);
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);
      return { success: true, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
