// Windows click-no-activate policy for the meeting overlay window family.
//
// macOS gets "clicks never steal focus" from the native side: the overlay,
// pill, toggle and the overlay-anchored popovers are NSPanels with
// becomesKeyOnlyIfNeeded (+ _setPreventsActivation via applyStealthToWindow),
// so clicking a button never activates Natively and the user's meeting app
// keeps frontmost/key status.
//
// Windows has no panel concept. The equivalent is the WS_EX_NOACTIVATE
// extended style, which Electron applies via BrowserWindow.setFocusable(false):
// the window still receives every mouse event (buttons, hover, wheel,
// app-region drags all work), but a click no longer activates the HWND — the
// foreground app (Zoom, browser, IDE) keeps focus and never fires blur.
//
// The one thing WS_EX_NOACTIVATE removes is keyboard input: typing requires
// real activation. So the policy is two-state:
//   • at rest: focusable=false → clicks are non-activating (parity with the
//     mac panel's becomesKeyOnlyIfNeeded "clicks don't promote to key");
//   • typing:  when the renderer reports that an editable element wants the
//     caret (focusin/pointerdown on an input — see the preload bridge),
//     setTypingFocus(win, true) flips focusable on and focuses the window —
//     the same moment the mac panel WOULD become key ("only if needed");
//   • the grant self-reverts on the window's own blur/hide (attach wires
//     this), so a finished typing session can never leave the window in the
//     click-activating state.
//
// Pure module by design: no electron import, platform injectable — both
// platform branches are unit-testable from either OS (see
// __tests__/windowsFocusPolicy.test.mjs).

/** Structural subset of BrowserWindow this policy needs. */
export interface NoActivateWindowLike {
  isDestroyed(): boolean;
  setFocusable(focusable: boolean): void;
  focus(): void;
  on(event: 'blur' | 'hide', listener: () => void): unknown;
}

/** Platforms whose windows activate (steal focus) on click by default. */
export function isClickActivatingPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

// Windows currently under the no-activate policy. WeakSet: entries die with
// their window, and membership doubles as the allowlist for the renderer's
// typing-focus IPC (only attached windows may be made focusable by it).
const managed = new WeakSet<object>();

/**
 * Put a window under the no-activate policy (win32 only; no-op elsewhere).
 * Call once, right after construction, while the window is still hidden so
 * WS_EX_NOACTIVATE is in place before the first show.
 * Returns true if the policy was applied.
 */
export function attachNoActivate(
  win: NoActivateWindowLike | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!isClickActivatingPlatform(platform)) return false;
  if (!win || win.isDestroyed()) return false;
  managed.add(win);
  win.setFocusable(false);
  // Self-reverting typing grant: however focus was gained (typing bridge,
  // chat:focusInput shortcut), losing it or hiding must land back on
  // non-activating, or the next meeting click would steal foreground again.
  const revert = () => {
    if (!win.isDestroyed()) win.setFocusable(false);
  };
  win.on('blur', revert);
  win.on('hide', revert);
  return true;
}

/** True if attachNoActivate() was applied to this window. */
export function isNoActivateManaged(win: object | null | undefined): boolean {
  return !!win && managed.has(win);
}

/**
 * Transient typing grant for a managed window: focusable+focused while an
 * editable element holds the caret, back to non-activating when it lets go.
 * Ignores unmanaged windows (launcher etc.) and non-win32 platforms.
 * Returns true if the state was applied.
 */
export function setTypingFocus(
  win: (NoActivateWindowLike & object) | null | undefined,
  active: boolean,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!isClickActivatingPlatform(platform)) return false;
  if (!win || win.isDestroyed() || !managed.has(win)) return false;
  if (active) {
    win.setFocusable(true);
    win.focus();
  } else {
    win.setFocusable(false);
  }
  return true;
}
