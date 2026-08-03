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
// The window stays non-activating PERMANENTLY — it is never focused. This is a
// stricter, simpler policy than an earlier "focus only while typing" attempt:
// focusing to type is exactly what stole focus (the meeting app blurred the
// instant the caret landed). Typing without focus is instead handled the same
// way as macOS — a native keystroke hook (WH_KEYBOARD_LL, see
// native-module/src/keyboard_hook_windows.rs) siphons keys and the renderer
// injects the characters, so the window never has to become foreground. This
// module's only job is the no-activate mouse policy; keyboard input lives in
// StealthKeyboardManager.
//
// Pure module by design: no electron import, platform injectable — both
// platform branches are unit-testable from either OS (see
// __tests__/windowsFocusPolicy.test.mjs).

/** Structural subset of BrowserWindow this policy needs. */
export interface NoActivateWindowLike {
  isDestroyed(): boolean;
  setFocusable(focusable: boolean): void;
  on(event: 'blur' | 'hide', listener: () => void): unknown;
}

/** Platforms whose windows activate (steal focus) on click by default. */
export function isClickActivatingPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

// Windows currently under the no-activate policy. WeakSet: entries die with
// their window. Membership gates the hover-gate's setFocusable(true) so it
// cannot silently re-arm click-activation on a managed window.
const managed = new WeakSet<object>();

/**
 * Put a window under the no-activate policy (win32 only; no-op elsewhere).
 * Call once, right after construction, while the window is still hidden so
 * WS_EX_NOACTIVATE is in place before the first show. The window is never
 * focused thereafter; a defensive blur/hide handler re-asserts focusable=false
 * in case any other code path (or Electron internals) flips it.
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
  // Defensive re-assert: if anything ever flips focusable on (a stray focus(),
  // an Electron internal), losing focus or hiding restores the non-activating
  // state, so the next meeting click can never steal foreground focus.
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
