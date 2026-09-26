/**
 * Pure decision for what the launcher window's close (X / Alt+F4) should do
 * (unit-tested, platform injected so both branches run on any host).
 *
 * Extracted from WindowHelper's launcher 'close' handler on 2026-09-12 after
 * three Windows reviews said "closing the app doesn't work / only in Task
 * Manager": on win32/linux the close hides to the tray, but undetectable mode
 * destroys the tray AND removes the taskbar button, so after X nothing on
 * screen could bring the window back or quit it. Hide-to-tray is only a valid
 * answer to X while a tray exists to come back from; with no tray, X quits.
 *
 * @param {{
 *   platform: string,
 *   isDev: boolean,
 *   quitting: boolean,
 *   hasTray: boolean,
 * }} input
 * @returns {'close' | 'hide' | 'quit'}
 *   'close' — let the OS close proceed (darwin, or the app is already quitting)
 *   'hide'  — preventDefault and hide to the tray
 *   'quit'  — preventDefault and quit the app
 */
export function decideLauncherClose({ platform, isDev, quitting, hasTray }) {
  if (platform === 'darwin') return 'close';
  if (quitting) return 'close';
  // Dev: a hidden headless process survives Ctrl-C on Windows and holds the
  // single-instance lock and port 5180 (2026-07-10 rule).
  if (isDev) return 'quit';
  return hasTray ? 'hide' : 'quit';
}
