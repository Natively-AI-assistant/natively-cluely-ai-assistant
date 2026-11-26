// Hides Natively while the screen is mirrored to a projector or another display
// in Undetectable mode (GitHub #630).
//
// Undetectable keeps the windows out of screen CAPTURE. A mirror is not a
// capture: the GPU sends the same picture to the laptop panel and the
// projector, so a protected window shows to the room. No OS lets a window show
// on one output of a mirror set and not the other, so the only protection is
// to hide the windows while the mirror lasts.
//
//   - Undetectable on: polls the native mirror check, and the caller also runs
//     check() on display changes and whenever a window is shown, so a window
//     that opens by itself (a meeting starting) is hidden at once.
//   - Mirroring starts with any window on screen: hides every window and keeps
//     a restore token. A later hide (a window that opened by itself) is merged
//     into it, so the restore shows what is current (a meeting that started
//     mid-mirror comes back as the overlay) plus what was up before.
//   - The user presses Toggle Visibility (Cmd/Ctrl+B) while mirrored: their
//     choice wins. What the guard hid comes back at once (the restore token is
//     spent), and nothing is hidden again until mirroring stops and starts
//     again. The first such press tells the user, in the window, that it is
//     on the mirrored screen too: without it Natively just vanished and came
//     back, with no word on why.
//   - Mirroring stops, or Undetectable turns off: the windows hidden by the
//     guard come back, without focus.
//   - shouldHoldShow() feeds mirrorShowGate.ts, which keeps a window that
//     opens by itself off the projector entirely, instead of showing it for a
//     frame before check() hides it.
//
// The native check is native-module/src/display_mirror.rs (macOS
// CGDisplayIsInMirrorSet, Windows QueryDisplayConfig clone paths). An older
// native binary without it makes the guard a no-op. Pure: no electron import,
// every effect injected, so both the hide and restore paths are unit-tested
// (__tests__/PresentationMirrorGuard2026_11_25.test.mjs).

export interface DisplayMirrorState {
  mirrored: boolean;
  /** Windows only: the mirror set includes a Miracast display. */
  wireless: boolean;
  mirroredDisplays: number;
}

export interface PresentationMirrorGuardDeps<Token> {
  /** The native check; null when the native module or the export is missing. */
  readMirrorState: () => DisplayMirrorState | null;
  isUndetectable: () => boolean;
  /** Whether any Natively window the guard can hide is on screen. */
  anyWindowVisible: () => boolean;
  /** Another path (a screenshot) is hiding and restoring the windows itself. */
  isBusy: () => boolean;
  /** Hide every window; returns what restore() needs to bring them back. */
  hideAll: () => Token;
  restore: (token: Token) => void;
  /** Fold a later hide into the token kept so far. Default: keep the later one. */
  merge?: (earlier: Token, later: Token) => Token;
  /**
   * Show the windows mirrorShowGate.ts held off screen before this guard
   * hid them (the mirror ended first, or the user revealed). Returns how many.
   */
  releaseHeld?: () => number;
  /**
   * The mirror ended and windows the guard kept off it came back (not after
   * the user revealed them, and not because Undetectable was turned off).
   * Main tells the restored window, which shows a notice only the user sees.
   */
  onShownAfterMirror?: () => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  log?: (message: string) => void;
}

export const MIRROR_POLL_MS = 1000;

export function createPresentationMirrorGuard<Token>(deps: PresentationMirrorGuardDeps<Token>) {
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stop = deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let pollTimer: unknown = null;
  let mirrored = false;
  let userRevealed = false;
  let restoreToken: { token: Token } | null = null;
  let readFailureLogged = false;
  let restoring = false;

  const readMirrored = (): DisplayMirrorState | null => {
    try {
      return deps.readMirrorState();
    } catch (e: any) {
      if (!readFailureLogged) {
        readFailureLogged = true;
        deps.log?.(`[PresentationMirror] mirror check failed: ${e?.message ?? e}`);
      }
      return null;
    }
  };

  const restoreHidden = (): boolean => {
    if (!restoreToken) return false;
    const { token } = restoreToken;
    restoreToken = null;
    restoring = true; // the restore's own shows must not be held
    try {
      deps.restore(token);
    } catch (e: any) {
      deps.log?.(`[PresentationMirror] restore failed: ${e?.message ?? e}`);
    } finally {
      restoring = false;
    }
    return true;
  };

  const releaseHeld = (): number => {
    try {
      return deps.releaseHeld?.() ?? 0;
    } catch (e: any) {
      deps.log?.(`[PresentationMirror] release failed: ${e?.message ?? e}`);
      return 0;
    }
  };

  const check = (): void => {
    const undetectable = deps.isUndetectable();
    const state = undetectable ? readMirrored() : null;
    if (!state?.mirrored) {
      if (mirrored) deps.log?.('[PresentationMirror] mirroring ended');
      mirrored = false;
      userRevealed = false;
      const restored = restoreHidden();
      const released = releaseHeld();
      if ((restored || released > 0) && undetectable) {
        try {
          deps.onShownAfterMirror?.();
        } catch (e: any) {
          deps.log?.(`[PresentationMirror] notice failed: ${e?.message ?? e}`);
        }
      }
      return;
    }
    if (!mirrored) {
      mirrored = true;
      userRevealed = false;
      deps.log?.(
        `[PresentationMirror] mirroring detected (${state.mirroredDisplays} displays${state.wireless ? ', wireless' : ''})`,
      );
    }
    if (userRevealed || deps.isBusy() || !deps.anyWindowVisible()) return;
    try {
      const token = deps.hideAll();
      restoreToken = restoreToken
        ? { token: deps.merge ? deps.merge(restoreToken.token, token) : token }
        : { token };
      deps.log?.('[PresentationMirror] windows hidden while mirrored');
    } catch (e: any) {
      deps.log?.(`[PresentationMirror] hide failed: ${e?.message ?? e}`);
    }
  };

  return {
    check,

    /** Follow Undetectable: poll while on; when off, stop and restore. */
    sync(undetectable: boolean): void {
      if (undetectable) {
        if (pollTimer === null) pollTimer = every(check, MIRROR_POLL_MS);
      } else if (pollTimer !== null) {
        stop(pollTimer);
        pollTimer = null;
      }
      check();
    },

    /**
     * The user pressed Toggle Visibility (or a tray Show). While mirrored that
     * is a deliberate choice to show Natively on the shared screen, so stop
     * hiding until the mirror ends. Whatever the guard hid comes back now,
     * through the same restore a screenshot uses, so the notepad or Settings
     * return along with the main window rather than being lost.
     *
     * Call it BEFORE the toggle. `restored`: it restored windows; the caller
     * then runs its own toggle only if the main window is still hidden (the
     * guard hid only the notepad, say), or the toggle would hide again what
     * was just restored. `firstWhileMirrored`: the first press of this mirror,
     * so the caller tells the user, in the window just shown, that it is on
     * the mirrored screen too (once per mirror, not on every toggle).
     */
    noteUserReveal(): { restored: boolean; firstWhileMirrored: boolean } {
      // Read now rather than trust the last poll: a mirror that began less
      // than a poll ago would otherwise hide the window this press shows.
      const state = deps.isUndetectable() ? readMirrored() : null;
      let firstWhileMirrored = false;
      if (state?.mirrored) {
        mirrored = true;
        if (!userRevealed) {
          firstWhileMirrored = true;
          deps.log?.('[PresentationMirror] shown by the user while mirrored');
        }
        userRevealed = true;
      }
      // Also when the mirror ended less than a poll ago: the restore is due.
      const hadHidden = restoreToken !== null;
      restoreHidden();
      const released = releaseHeld();
      return { restored: hadHidden || released > 0, firstWhileMirrored };
    },

    /**
     * Whether a window about to be shown should be held off screen
     * (mirrorShowGate.ts). Reads the mirror state now: a show is when a
     * window would otherwise reach the projector.
     */
    shouldHoldShow(): boolean {
      if (restoring || userRevealed || !deps.isUndetectable()) return false;
      return readMirrored()?.mirrored === true;
    },

    get mirrored(): boolean {
      return mirrored;
    },
  };
}

export type PresentationMirrorGuard = ReturnType<typeof createPresentationMirrorGuard>;
