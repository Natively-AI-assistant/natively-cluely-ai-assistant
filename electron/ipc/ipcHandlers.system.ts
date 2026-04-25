/**
 * System handlers extracted from ipcHandlers.ts.
 * Permissions, logging, OS info.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { app, ipcMain, shell, systemPreferences } from 'electron'
import type { AppState } from '../main'
import { safeHandle } from './safeHandle'
import * as console from 'console'

export function registerSystemHandlers(_appState: AppState): void {
  safeHandle('permissions:check', async () => {
    if (process.platform === 'darwin') {
      const mic = systemPreferences.getMediaAccessStatus('microphone')
      const screen = systemPreferences.getMediaAccessStatus('screen')
      return { microphone: mic, screen, platform: 'darwin' }
    }
    return {
      microphone: 'granted',
      screen: 'granted',
      platform: process.platform,
    }
  })

  safeHandle('permissions:request-mic', async () => {
    if (process.platform !== 'darwin') return true
    try {
      return await systemPreferences.askForMediaAccess('microphone')
    } catch {
      return false
    }
  })

  safeHandle('get-os-version', async () => {
    const platform = process.platform
    if (platform === 'darwin') {
      const darwinMajor = parseInt(os.release().split('.')[0] || '0', 10)
      const macosMajor =
        darwinMajor >= 25
          ? darwinMajor + 1
          : darwinMajor >= 20
            ? darwinMajor - 9
            : null
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`
    }
    if (platform === 'win32') {
      const release = os.release()
      const majorBuild = parseInt(release.split('.')[2] || '0', 10)
      return majorBuild >= 22000 ? `Windows 11` : `Windows 10`
    }
    return os.type()
  })

  safeHandle('get-log-file-path', async () => {
    try {
      return path.join(app.getPath('documents'), 'natively_debug.log')
    } catch {
      return null
    }
  })

  safeHandle('open-log-file', async () => {
    try {
      const logPath = path.join(app.getPath('documents'), 'natively_debug.log')
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '')
      }
      await shell.openPath(logPath)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Fire-and-forget: renderer forwards its console output to the main-process log file.
  // Only written when verbose logging is enabled.
  ipcMain.on('forward-log-to-file', (_event, level: string, msg: string) => {
    if (!_appState.getVerboseLogging()) return
    const tag = level === 'error' ? '[RENDERER-ERROR]' : level === 'warn' ? '[RENDERER-WARN]' : '[RENDERER]'
    console.log(`${tag} ${msg}`)
  })
}
