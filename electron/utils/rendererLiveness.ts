// Is a reused window still backed by a running renderer?
//
// Several small windows (the model picker, the screenshot cropper) are created
// once, kept hidden, and shown again for every open. The guard on reuse used
// to be `!win || win.isDestroyed()`. A window whose RENDERER process has gone
// away (crash, out of memory, killed) passes that guard: the BrowserWindow is
// still there, it shows and positions normally, and it draws nothing. Reusing
// it meant an empty window on every open until the app was restarted.
//
// Pure module: no electron import and no platform branch, so the same code
// runs on macOS and Windows. Reproduced and re-checked on macOS only (see
// __tests__/ModelSelectorDeadRenderer2026_10_05.test.mjs); not executed on
// Windows.

/** Structural subset of BrowserWindow these checks need. */
export interface RendererBackedWindowLike {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    isCrashed(): boolean;
    on(event: 'render-process-gone', listener: (event: unknown, details: { reason?: string }) => void): unknown;
  };
}

/** What hasLiveRenderer reads: no listener registration needed. */
type LivenessCheckable = Pick<RendererBackedWindowLike, 'isDestroyed'> & {
  webContents: Pick<RendererBackedWindowLike['webContents'], 'isDestroyed' | 'isCrashed'>;
};

/**
 * True when the window exists and its renderer process is alive.
 *
 * A plain boolean, not a type guard: `false` does not mean "no window" (it may
 * be a real window with a dead renderer that still has to be cleaned up), and
 * a guard would tell the compiler otherwise.
 */
export function hasLiveRenderer(win: LivenessCheckable | null | undefined): boolean {
  if (!win) return false;
  try {
    if (win.isDestroyed()) return false;
    const contents = win.webContents;
    return !contents.isDestroyed() && !contents.isCrashed();
  } catch {
    // Electron throws "Object has been destroyed" from a window torn down
    // between the two reads. That window cannot be reused either.
    return false;
  }
}

/**
 * Call `onGone` once when the window's renderer process goes away for any
 * reason other than a clean exit.
 *
 * Deferred past the event on purpose. This runs inside the event's emit, and
 * other listeners for the same event (main.ts's app-level handler, the
 * renderer diagnostics) read this window's webContents. A caller that destroys
 * the window here would hand whichever of them runs later a destroyed object.
 */
export function onRendererGone(
  win: RendererBackedWindowLike,
  onGone: () => void,
  defer: (fn: () => void) => void = setImmediate,
): void {
  let fired = false;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (fired || details?.reason === 'clean-exit') return;
    fired = true;
    defer(onGone);
  });
}

/** Replacements allowed inside the rolling window: main.ts's reload limits. */
export const RESPAWN_MAX = 3;
export const RESPAWN_WINDOW_MS = 60_000;

/**
 * May a window that just lost its renderer be rebuilt in the background now?
 *
 * `history` holds the times of earlier rebuilds and is updated in place. Past
 * the limit the answer is no, so a renderer that dies on every start cannot
 * turn into a rebuild loop; the window is then built on its next open instead.
 */
export function allowRespawn(
  history: number[],
  now: number,
  max: number = RESPAWN_MAX,
  windowMs: number = RESPAWN_WINDOW_MS,
): boolean {
  const recent = history.filter((t) => now - t < windowMs);
  history.length = 0;
  history.push(...recent);
  if (recent.length >= max) return false;
  history.push(now);
  return true;
}
