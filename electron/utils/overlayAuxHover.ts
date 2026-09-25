// Clears a stale CSS :hover in an overlay aux window (top pill, resize toggle).
//
// Chromium drops :hover only when it sees the pointer leave. These windows are
// persistent — hidden when a meeting ends, re-shown for the next one — and the
// usual way one gets hidden is the user clicking a button in it (Stop). The
// window is ordered out from under the cursor, no leave is ever delivered, and
// the next meeting opens with that button still drawn hovered (a red Stop).
// Measured on macOS with real mouse events; a synthetic mouseLeave clears it.
//
// Deliberately NOT gated on isVisible(): on macOS the pill is an AppKit child of
// the overlay, and parent.hide() orders it out implicitly — by the time the
// aux-visibility sync runs it already reads as hidden, and no 'hide' fires.

export interface HoverResettableWindow {
  isDestroyed(): boolean;
  webContents: {
    sendInputEvent(event: { type: 'mouseLeave'; x: number; y: number }): void;
  };
}

export function clearStaleHover(win: HoverResettableWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.sendInputEvent({ type: 'mouseLeave', x: -1, y: -1 });
  } catch {
    // Renderer gone or reloading: it has no hover state left to clear.
  }
}
