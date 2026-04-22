/**
 * Safe IPC handler wrapper extracted from ipcHandlers.ts.
 * Ensures no duplicate handlers are registered.
 */

import { ipcMain } from 'electron';

export const safeHandle = (
  channel: string,
  listener: (event: any, ...args: any[]) => Promise<any> | any
): void => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
};
