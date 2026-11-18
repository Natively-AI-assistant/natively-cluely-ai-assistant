/**
 * State the connection check shares across the app's bundles (2026-11-18, #759).
 *
 * scripts/build-electron.js runs esbuild with bundle:true over every .ts as its
 * own entry point, so main.js, ipcHandlers.js and audio/NativelyProSTT.js each
 * inline their own copy of connectivityWiring. A module-local `let` would give
 * each its own watcher (no shared 30-minute throttle), and the diagnostic report,
 * built in ipcHandlers, would never see the check main.js ran. Anchored on
 * globalThis, as redactForLog.ts does for its level.
 */
const KEY = '__nativelyConnectivityV1__';

export interface ConnectivityState {
  watcher: unknown | null;
  lastDiagnosis?: { reason?: string; verdict?: string; report?: Record<string, unknown> };
  /** The Pro check's most recent failure text, read after an undo to tell "server answered an error" from "no connection". */
  lastProError?: string;
  lastNotice?: { verdict: string; message: string; healed: boolean; at: number };
}

export function connectivityState(): ConnectivityState {
  const g = globalThis as unknown as Record<string, ConnectivityState | undefined>;
  return (g[KEY] ??= { watcher: null });
}
