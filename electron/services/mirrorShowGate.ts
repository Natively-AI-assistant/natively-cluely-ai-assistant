// Stops a Natively window from reaching a mirrored screen at all (GitHub #630).
//
// presentationMirrorGuard.ts hides the windows while the screen is mirrored,
// and checks again whenever a window is shown. That check runs AFTER the show,
// so a window that opens by itself (a meeting starting, the notepad) could be
// on the projector for a frame before it was hidden. This gate closes that
// gap: it wraps show / showInactive on Natively's own windows and, while the
// guard says to hold, does not put the window on screen.
//
// A held window is one its helper believes it showed. To keep every helper's
// bookkeeping true (Notes, Settings and the model selector read
// win.isVisible(); their hide paths bail out on a window that is not visible),
// a held window reports isVisible() === true. onHeld() then queues the guard's
// check, which hides it through the normal screenshot hide: that calls hide(),
// which ends the hold, and records it in the restore token, so the window
// comes back when the mirror ends. If the mirror ends, or the user presses
// Toggle Visibility, before that check runs, releaseAll() shows the held
// windows for real, without focus.
//
// focus() and moveTop() are held too while the window is not on screen: on
// macOS both order a hidden window in, which would show it.
//
// Pure: no electron import. Installed on every BrowserWindow; isGuarded()
// picks Natively's windows at call time, since a window is created before its
// helper keeps a reference to it. Tested in
// __tests__/MirrorShowGate2026_11_26.test.mjs.

export interface GateableWindow {
  show(): void;
  showInactive(): void;
  focus(): void;
  moveTop(): void;
  hide(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
}

export interface MirrorShowGateDeps {
  /** One of the windows the mirror guard hides and restores. */
  isGuarded: (win: GateableWindow) => boolean;
  /** Undetectable is on, the screen is mirrored and the user has not revealed. */
  shouldHold: () => boolean;
  /** A show was held: run the guard's check so it records and hides it. */
  onHeld: () => void;
  log?: (message: string) => void;
}

export function createMirrorShowGate(deps: MirrorShowGateDeps) {
  const held = new Set<GateableWindow>();
  const originals = new WeakMap<GateableWindow, Pick<GateableWindow, 'showInactive' | 'isVisible'>>();
  let heldLogged = false;

  const tryHold = (win: GateableWindow): boolean => {
    let hold = false;
    try {
      hold = deps.isGuarded(win) && deps.shouldHold();
    } catch (e: any) {
      deps.log?.(`[MirrorShowGate] hold check failed: ${e?.message ?? e}`);
      return false; // fail open: never strand a window the user asked for
    }
    if (!hold) return false;
    held.add(win);
    if (!heldLogged) {
      heldLogged = true;
      deps.log?.('[MirrorShowGate] holding a window off the mirrored screen');
    }
    deps.onHeld();
    return true;
  };

  return {
    install(win: GateableWindow): void {
      if (originals.has(win)) return;
      const show = win.show.bind(win);
      const showInactive = win.showInactive.bind(win);
      const focus = win.focus.bind(win);
      const moveTop = win.moveTop.bind(win);
      const hide = win.hide.bind(win);
      const isVisible = win.isVisible.bind(win);
      originals.set(win, { showInactive, isVisible });

      win.show = () => {
        if (tryHold(win)) return;
        held.delete(win);
        show();
      };
      win.showInactive = () => {
        if (tryHold(win)) return;
        held.delete(win);
        showInactive();
      };
      win.focus = () => {
        if (held.has(win)) return;
        if (!isVisible() && tryHold(win)) return;
        focus();
      };
      win.moveTop = () => {
        if (held.has(win)) return;
        if (!isVisible() && tryHold(win)) return;
        moveTop();
      };
      win.hide = () => {
        held.delete(win);
        hide();
      };
      win.isVisible = () => held.has(win) || isVisible();
    },

    isHeld(win: GateableWindow): boolean {
      return held.has(win);
    },

    /** Show every held window for real, without focus. Returns how many. */
    releaseAll(): number {
      heldLogged = false; // log once per mirror, not once per process
      let released = 0;
      for (const win of [...held]) {
        held.delete(win);
        if (win.isDestroyed()) continue;
        try {
          originals.get(win)?.showInactive();
          released += 1;
        } catch (e: any) {
          deps.log?.(`[MirrorShowGate] release failed: ${e?.message ?? e}`);
        }
      }
      return released;
    },
  };
}

export type MirrorShowGate = ReturnType<typeof createMirrorShowGate>;
