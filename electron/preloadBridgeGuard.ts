// electron/preloadBridgeGuard.ts
//
// A window whose page finished loading without window.electronAPI cannot talk
// to the app at all: the launcher renders, but every button, setting and
// meeting control is dead until the app is restarted ("Cannot read properties
// of undefined (reading 'getCanAutoUpdate')" from UpdateBanner, and Electron's
// "Attempted to get the 'ipcNative' object but it was missing").
//
// Seen 2026-10-15/16 in dev-mode runs on macOS, on the old and the new build
// alike: about 1 start in 5 in some sessions, never on demand (0 of 16 in a
// loop), no preload-error event. One affected run recovered by itself when
// Vite reloaded the page, so a reload is what heals it. Whether a packaged
// build can hit it is not known.
//
// The check does not ask the page: in the broken state the renderer's IPC
// bridge is what is missing, so executeJavaScript cannot be trusted to answer.
// Instead the preload reports in on PRELOAD_READY_CHANNEL every time it runs,
// and a page that finished loading without a report since its load began is
// reloaded, at most PRELOAD_GUARD_MAX_RELOADS times.
//
// Shared code: the same webContents and ipcMain calls on macOS and Windows.

export const PRELOAD_READY_CHANNEL = 'natively:preload-ready';
/** Reloads per window before the guard gives up (so it can never loop). */
export const PRELOAD_GUARD_MAX_RELOADS = 2;
/** How long after did-finish-load the report may still arrive. */
export const PRELOAD_GUARD_WAIT_MS = 4000;

export interface PreloadGuardTarget {
  id: number;
  getURL(): string;
  reloadIgnoringCache(): void;
  isDestroyed(): boolean;
}

const readyAt = new Map<number, number>();
const loadStartedAt = new Map<number, number>();
const reloadsById = new Map<number, number>();
let listening = false;

/** The preload of webContents `id` ran and exposed its API. */
export function markPreloadReady(id: number, at: number = Date.now()): void {
  readyAt.set(id, at);
}

/** A navigation of webContents `id` began: earlier reports no longer count. */
export function markLoadStarted(id: number, at: number = Date.now()): void {
  loadStartedAt.set(id, at);
}

function listenOnce(): void {
  if (listening) return;
  listening = true;
  try {
    const { ipcMain } = require('electron') as typeof import('electron');
    ipcMain.on(PRELOAD_READY_CHANNEL, (event) => markPreloadReady(event.sender.id));
  } catch { listening = false; }
}

/**
 * Call on did-finish-load (after the wait). Resolves to what it did: 'ok',
 * 'reloaded', 'gave-up' (still no report after PRELOAD_GUARD_MAX_RELOADS
 * reloads), or 'skipped' (not one of the app's own pages, or gone).
 */
export function guardPreloadBridge(
  wc: PreloadGuardTarget,
  tag: string,
  log: (msg: string) => void = (m) => console.error(m),
): 'ok' | 'reloaded' | 'gave-up' | 'skipped' {
  try {
    if (wc.isDestroyed()) return 'skipped';
    // Only the app's own pages load the preload (every one carries ?window=).
    if (!/[?&]window=/.test(wc.getURL())) return 'skipped';
    const ready = readyAt.get(wc.id) ?? 0;
    const started = loadStartedAt.get(wc.id) ?? 0;
    if (ready > 0 && ready >= started) {
      reloadsById.delete(wc.id);
      return 'ok';
    }
    const done = reloadsById.get(wc.id) ?? 0;
    if (done >= PRELOAD_GUARD_MAX_RELOADS) {
      log(`[Renderer:${tag}] PRELOAD-BRIDGE-MISSING after ${done} reload(s); giving up`);
      return 'gave-up';
    }
    reloadsById.set(wc.id, done + 1);
    log(`[Renderer:${tag}] PRELOAD-BRIDGE-MISSING: no preload report after load; reloading (${done + 1}/${PRELOAD_GUARD_MAX_RELOADS})`);
    wc.reloadIgnoringCache();
    return 'reloaded';
  } catch {
    return 'skipped';
  }
}

type GuardedContents = PreloadGuardTarget & {
  on(event: 'did-start-navigation' | 'did-finish-load' | 'destroyed', listener: (...args: any[]) => void): unknown;
};

/** Guards every load of this window. Call right after creating it. */
export function attachPreloadBridgeGuard(
  win: { webContents: GuardedContents },
  tag: string,
  opts: { waitMs?: number; log?: (msg: string) => void } = {},
): void {
  listenOnce();
  try {
    const wc = win.webContents;
    const id = wc.id;
    // A new document in the main frame (not a subframe, not an in-page
    // navigation): reports from the previous document no longer count. Fires
    // before the new document's preload runs. Electron passes the details both
    // as properties of the event and, deprecated, as positional arguments.
    wc.on('did-start-navigation', (e: any, _url?: string, isInPlace?: boolean, isMainFrame?: boolean) => {
      const main = typeof e?.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame === true;
      const sameDocument = typeof e?.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace === true;
      if (main && !sameDocument) markLoadStarted(id);
    });
    wc.on('did-finish-load', () => {
      setTimeout(() => { guardPreloadBridge(wc, tag, opts.log); }, opts.waitMs ?? PRELOAD_GUARD_WAIT_MS);
    });
    wc.on('destroyed', () => { readyAt.delete(id); loadStartedAt.delete(id); reloadsById.delete(id); });
  } catch { /* a window torn down mid-construction */ }
}
