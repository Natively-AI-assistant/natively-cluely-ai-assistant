// Windows taskbar identity: which AppUserModelID the running app uses, and the
// open-at-login registry entry that Electron names after it.
//
// The NSIS installer (electron-builder) stamps every Start-menu / desktop
// shortcut with System.AppUserModel.ID = build.appId (WinShell::SetLnkAUMI in
// app-builder-lib/templates/nsis/include/installer.nsh). The taskbar groups a
// window with a pinned shortcut only when the two IDs match. The app used to
// set com.natively.assistant.none even when undisguised, so a user who pinned
// Natively saw the pin AND a second button for the running window.
//
// Undisguised → build.appId (the shortcut's ID). Disguise modes keep their own
// IDs on purpose: a disguised window must not merge into the real app's pin.
//
// Electron writes the open-at-login Run value under the CURRENT
// AppUserModelID unless a name is given (browser_win.cc SetLoginItemSettings),
// so the entry used to be named after whatever disguise was active when the
// user toggled it — and changing the ID would orphan it. It is now always
// written under one stable name, and the old per-disguise names are cleaned.
//
// Pure module: no electron import, platform injectable (see
// __tests__/windowsTaskbarPolicy.test.mjs, which also pins the ID to
// package.json build.appId).

export type DisguiseModeId = 'terminal' | 'settings' | 'activity' | 'none';

/** Must equal package.json build.appId (the NSIS shortcut AppUserModelID). */
export const WINDOWS_APP_USER_MODEL_ID = 'com.electron.meeting-notes';

const DISGUISE_MODES: readonly DisguiseModeId[] = ['none', 'terminal', 'settings', 'activity'];

/** Open-at-login value names written by builds before 2026-09-23. */
export const LEGACY_LOGIN_ITEM_NAMES: readonly string[] = DISGUISE_MODES.map(
  (mode) => `com.natively.assistant.${mode}`,
);

export function appUserModelIdForDisguise(mode: DisguiseModeId): string {
  return mode === 'none' ? WINDOWS_APP_USER_MODEL_ID : `com.natively.assistant.${mode}`;
}

/** Structural subset of Electron's `app` for login items. */
export interface LoginItemApi {
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    path?: string;
    name?: string;
  }): void;
  getLoginItemSettings(options?: { path?: string }): {
    openAtLogin: boolean;
    launchItems?: Array<{ name: string; enabled: boolean; scope: string }>;
  };
}

export function setOpenAtLogin(
  api: LoginItemApi,
  platform: NodeJS.Platform,
  openAtLogin: boolean,
  exePath: string,
): void {
  if (platform !== 'win32') {
    api.setLoginItemSettings({ openAtLogin, openAsHidden: false, path: exePath });
    return;
  }
  // openAtLogin:false with a name deletes that Run value (and its
  // StartupApproved flag), so a stale entry can't keep launching the app.
  for (const name of LEGACY_LOGIN_ITEM_NAMES) {
    api.setLoginItemSettings({ openAtLogin: false, path: exePath, name });
  }
  api.setLoginItemSettings({ openAtLogin, openAsHidden: false, path: exePath, name: WINDOWS_APP_USER_MODEL_ID });
}

export function getOpenAtLogin(api: LoginItemApi, platform: NodeJS.Platform, exePath: string): boolean {
  if (platform !== 'win32') return api.getLoginItemSettings().openAtLogin;
  // Electron's own openAtLogin only reads the value named after the CURRENT
  // AppUserModelID; launchItems lists every Run value pointing at this exe.
  const owned = new Set([WINDOWS_APP_USER_MODEL_ID, ...LEGACY_LOGIN_ITEM_NAMES]);
  const items = api.getLoginItemSettings({ path: exePath }).launchItems ?? [];
  return items.some((item) => item.scope === 'user' && item.enabled && owned.has(item.name));
}
