// Keeps the overlay's separate chrome (top pill, resize toggle) in front of the
// overlay on Windows.
//
// There the three are independent always-on-top windows in one band, so the
// one raised last is in front. The overlay is raised repeatedly on purpose
// (setAlwaysOnTop(true, 'screen-saver') on blur and around every show, to get
// back above a screen-share surface), and nothing raised the pill or toggle
// after it. The toggle's window overlaps the overlay's top-right corner, so
// with the overlay in front part of its button stops taking clicks.
//
// macOS needs none of this: the pill and toggle are child windows of the
// overlay, and AppKit keeps children above their parent. Linux is left as it
// was (the overlay is never re-raised there, and moveTop can throw on
// Wayland).
//
// Pure, platform injected: both branches are unit-tested from either OS (see
// __tests__/OverlayAuxAboveOverlayWindows2026_10_05.test.mjs). The resulting
// z-order has not been observed on a Windows machine.

/** Structural subset of BrowserWindow this needs. */
export interface StackableWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  moveTop(): void;
}

/**
 * Raise each visible window to the front without activating it. Returns how
 * many were raised.
 *
 * Visible ones only: on Windows moveTop() is SetWindowPos(HWND_TOP, …
 * SWP_SHOWWINDOW), so it would show a window that is hidden on purpose (the
 * toggle, while the overlay has no content).
 */
export function raiseAboveOverlay(
  windows: Array<StackableWindowLike | null | undefined>,
  platform: NodeJS.Platform = process.platform,
): number {
  if (platform !== 'win32') return 0;
  let raised = 0;
  for (const win of windows) {
    if (!win || win.isDestroyed() || !win.isVisible()) continue;
    try {
      win.moveTop();
      raised++;
    } catch {
      // Ordering only; the window stays usable wherever it is.
    }
  }
  return raised;
}
