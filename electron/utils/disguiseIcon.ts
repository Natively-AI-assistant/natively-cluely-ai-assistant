// The icon each disguise mode paints on the macOS Dock tile / Windows window
// icons, as a path relative to the assets root (process.resourcesPath when
// packaged, app.getAppPath() in dev), and whether macOS should paint it at all.
// Pure module, platform injectable.
//
// The macOS app icon is the Icon Composer document assets/Natively.icon:
// electron-builder compiles it (actool) into Assets.car + CFBundleIconName, and
// the system renders it as a Liquid Glass icon — Apple's continuous-corner
// shape, specular rim, icon-grid margin, and the Default/Dark/Clear/Tinted
// styles. icons/mac/dock-icon.png is that same icon as macOS draws it (margin
// and glass baked in), for the two cases that need a bitmap — 1% larger, like
// the disguise icons, because the Dock drew setIcon() bitmaps ~1% smaller than
// their neighbours. Never
// point the Dock at assets/icon.png: that art is full-bleed (~98% of its
// canvas), so the tile drew ~20% larger than every other app — and the
// renderer's permissions onboarding imports it, so it stays as it is.
// Windows keeps its .ico; taskbar icons are meant to fill their canvas.

import type { DisguiseModeName } from './disguiseAppName';

export function disguiseIconRelativePath(mode: DisguiseModeName, platform: NodeJS.Platform): string {
  const isWin = platform === 'win32';
  switch (mode) {
    case 'terminal':
    case 'settings':
    case 'activity':
      return `assets/fakeicon/${isWin ? 'win' : 'mac'}/${mode}.png`;
    case 'none':
    default:
      if (platform === 'darwin') return 'assets/icons/mac/dock-icon.png';
      if (isWin) return 'assets/icons/win/icon.ico';
      return 'assets/icon.png';
  }
}

// Whether _applyDisguise should call app.dock.setIcon() on macOS. Any setIcon()
// replaces the live bundle icon with a static bitmap that no longer follows the
// user's icon style, so the undisguised packaged app leaves the tile alone.
// Once a disguise has painted the tile, the static render is the only way back
// (Electron documents no reset). Dev runs the stock Electron.app, whose bundle
// icon is Electron's, so dev always paints.
export function shouldSetMacDockIcon(mode: DisguiseModeName, isPackaged: boolean, dockIconOverridden: boolean): boolean {
  if (mode === 'terminal' || mode === 'settings' || mode === 'activity') return true;
  return !isPackaged || dockIconOverridden;
}
