// Which image the tray / menu-bar icon loads, and whether it needs resizing.
// Pure module: filesystem checks are injected so it runs under test on any OS.
//
// iconTemplate.png is drawn at the tray's exact size (16 px) and ships with an
// iconTemplate@2x.png (32 px) beside it. nativeImage.createFromPath picks the
// @2x file up as a second representation, which is what keeps the menu-bar
// icon sharp on Retina displays — so the template must NOT go through
// .resize(): that returns a single-scale image and would drop the @2x pair.
// The full-size fallback art (icon.png, hundreds of px) still needs resizing.

import path from 'node:path';

export interface TrayIconChoice {
  path: string;
  /** macOS template image (drawn by the system in the menu-bar colour). */
  template: boolean;
  /** The file is not drawn at tray size and must be resized to 16 x 16. */
  resizeTo16: boolean;
}

export function resolveTrayIcon(opts: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  exists: (p: string) => boolean;
}): TrayIconChoice {
  const root = opts.isPackaged ? opts.resourcesPath : opts.appPath;
  const candidates = [
    path.join(root, 'assets', 'iconTemplate.png'),
    // Dev fallback, as before.
    path.join(opts.appPath, 'src/components/iconTemplate.png'),
  ];
  for (const candidate of candidates) {
    if (opts.exists(candidate)) return { path: candidate, template: true, resizeTo16: false };
  }
  const fallback = opts.isPackaged
    ? path.join(opts.resourcesPath, 'assets', 'icon.png')
    : path.join(opts.appPath, 'src/components/icon.png');
  return { path: fallback, template: false, resizeTo16: true };
}
