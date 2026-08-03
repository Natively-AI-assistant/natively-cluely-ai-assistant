// Single source of truth for process/window/tray disguise identity.
//
// These mappings previously existed in three places — WindowHelper's launcher
// icon resolution, AppState._applyDisguise(), and AppState.buildTrayImage() —
// which had already drifted: the unpackaged branch resolved via
// path.resolve(__dirname, '../../assets/...') in one copy and
// path.join(app.getAppPath(), 'assets/...') in the others. Those happen to
// resolve to the same place today, but only because the esbuild output sits
// exactly two levels below the repo root; changing the bundle layout would
// silently break one copy and not the others.
//
// Adding a disguise mode must be a single edit here, not four. Every lookup is
// exhaustive over DisguiseMode so a new member is a compile error at each
// switch rather than a silent fallthrough to the wrong icon — the failure mode
// that matters, since a tray whose icon disagrees with the window identity is a
// stealth leak that surfaces no error.
//
// Platform is an explicit parameter (defaulted, not read inline) so both
// branches are assertable in tests without mutating process.platform.

import { app } from "electron"
import path from "path"

export type DisguiseMode = 'terminal' | 'settings' | 'activity' | 'none'

export const VALID_DISGUISE_MODES: readonly DisguiseMode[] = ['terminal', 'settings', 'activity', 'none'] as const

export function normalizeDisguiseMode(value: unknown): DisguiseMode {
  return (VALID_DISGUISE_MODES as readonly string[]).includes(value as string)
    ? (value as DisguiseMode)
    : 'none'
}

// Display name fed to process.title / app.setName() / the tray tooltip.
//
// NOTE the trailing space on every disguised name. It is deliberate and
// load-bearing: it keeps the disguised identity from colliding byte-for-byte
// with the real OS process it imitates. Callers that render the name to the
// user (tooltips) trim it; callers that set process identity must not.
export function disguiseAppName(
  mode: DisguiseMode,
  platform: NodeJS.Platform = process.platform,
): string {
  const isWin = platform === 'win32'
  switch (mode) {
    case 'terminal':
      return isWin ? "Command Prompt " : "Terminal "
    case 'settings':
      return isWin ? "Settings " : "System Settings "
    case 'activity':
      return isWin ? "Task Manager " : "Activity Monitor "
    case 'none':
      return "Natively"
  }
}

// Basename of the fake icon for a disguised mode; null for 'none' (which uses
// the real app icon, resolved by appIconPath).
export function disguiseIconFile(mode: DisguiseMode): string | null {
  switch (mode) {
    case 'terminal':
      return 'terminal.png'
    case 'settings':
      return 'settings.png'
    case 'activity':
      return 'activity.png'
    case 'none':
      return null
  }
}

// Absolute path to the fake icon for a disguised mode, or null for 'none'.
export function disguiseIconPath(
  mode: DisguiseMode,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const iconFile = disguiseIconFile(mode)
  if (!iconFile) return null

  const platformDir = platform === 'win32' ? 'win' : 'mac'
  const rel = `assets/fakeicon/${platformDir}/${iconFile}`

  return app.isPackaged
    ? path.join(process.resourcesPath, rel)
    : path.join(app.getAppPath(), rel)
}

// Absolute path to the REAL app icon — the 'none' case, and the defensive
// fallback whenever a disguise asset is missing.
export function appIconPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return app.isPackaged
      ? path.join(process.resourcesPath, "natively.icns")
      : path.join(app.getAppPath(), "assets/natively.icns")
  }

  if (platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, "assets/icons/win/icon.ico")
      : path.join(app.getAppPath(), "assets/icons/win/icon.ico")
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.png")
    : path.join(app.getAppPath(), "assets/icon.png")
}
