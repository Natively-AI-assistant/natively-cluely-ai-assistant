/**
 * Safe IPC handler wrapper extracted from ipcHandlers.ts.
 * Ensures no duplicate handlers are registered.
 */

import { ipcMain } from 'electron'

const registeredHandlers = new Set<string>()

export const safeHandle = (
  channel: string,
  listener: (event: any, ...args: any[]) => Promise<any> | any,
): void => {
  if (registeredHandlers.has(channel)) {
    console.warn(
      `[IPC] Handler for channel "${channel}" is being replaced. This may indicate duplicate registration.`,
    )
  } else {
    registeredHandlers.add(channel)
  }
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, listener)
}
