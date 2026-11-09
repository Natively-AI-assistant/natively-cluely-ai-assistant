// "Open Natively when you log in" is on by default for new installs.
//
// The Settings toggle reads the OS login item itself (getOpenAtLogin), so the
// default has to be written to the OS once, on a fresh install, and never again:
// after that the user's own choice stands. Installs upgraded from an older build
// are left exactly as they were (we can't tell "never touched" from "turned off").
//
// The write waits while the app runs from somewhere a login item would break:
//   - macOS outside /Applications (a mounted DMG or an App Translocation path:
//     the login item would point at a path that's gone after eject/reboot).
//     It stays pending and happens on the first launch from /Applications.
//   - the Windows portable exe (electron-builder extracts it to a temp folder,
//     so app.getPath('exe') is not the file the user keeps). Never applied.
//   - dev builds (would register the Electron binary). Never applied.
//
// Pure module: no electron import, platform injectable (see
// __tests__/openAtLoginDefault.test.mjs).

export type OpenAtLoginDefaultState = 'pending' | 'done';

export interface OpenAtLoginDefaultInput {
  platform: NodeJS.Platform;
  /** The stored marker; undefined = this build has never decided. */
  state: OpenAtLoginDefaultState | undefined;
  /** settings.json did not exist when this launch loaded it. */
  freshInstall: boolean;
  isPackaged: boolean;
  /** macOS: app.isInApplicationsFolder(). Ignored elsewhere. */
  inApplicationsFolder: boolean;
  /** Windows: electron-builder's portable exe (PORTABLE_EXECUTABLE_FILE set). */
  isPortable: boolean;
}

export interface OpenAtLoginDefaultDecision {
  /** Turn the OS login item on now. */
  enable: boolean;
  /** Marker to persist, or null to leave the stored value as it is. */
  nextState: OpenAtLoginDefaultState | null;
}

export function decideOpenAtLoginDefault(input: OpenAtLoginDefaultInput): OpenAtLoginDefaultDecision {
  if (input.state === 'done') return { enable: false, nextState: null };
  if (!input.isPackaged) return { enable: false, nextState: null };

  // First decision for this install: an upgraded install is done without change.
  const state = input.state ?? (input.freshInstall ? 'pending' : 'done');
  if (state === 'done') return { enable: false, nextState: 'done' };

  switch (input.platform) {
    case 'darwin':
      if (!input.inApplicationsFolder) {
        return { enable: false, nextState: input.state === 'pending' ? null : 'pending' };
      }
      return { enable: true, nextState: 'done' };
    case 'win32':
      if (input.isPortable) return { enable: false, nextState: 'done' };
      return { enable: true, nextState: 'done' };
    default:
      // Natively ships for macOS and Windows only; don't guess a login item.
      return { enable: false, nextState: 'done' };
  }
}
