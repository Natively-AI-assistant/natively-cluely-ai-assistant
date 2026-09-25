// What a renderer's window.open / target="_blank" may do.
//
// Nothing in the app wants a second Electron window from a link: every
// window.open() caller is a fallback for electronAPI.openExternal. Without a
// handler, Electron opened a default BrowserWindow — its own taskbar button on
// Windows and no content protection, so it showed up even in undetectable mode
// and in screen shares. Every such request is now denied, and https links go
// to the default browser — the same rule as the 'open-external' IPC for web
// URLs. Pure module; wired through app.on('web-contents-created') in main.ts.

export function shouldOpenExternally(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
