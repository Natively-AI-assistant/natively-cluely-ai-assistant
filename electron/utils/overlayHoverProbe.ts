// A second way for the overlay's click-through gate to reopen.
//
// While the pointer is over a transparent part of the overlay window the
// window ignores the mouse, and it is the overlay's page that reopens it, on
// the first mouse move it sees over the panel. An ignoring window gets no
// mouse moves of its own; setIgnoreMouseEvents' `forward: true` feeds them to
// it. On Windows that feed is a low-level mouse hook on the main thread, and
// Windows silently removes a low-level hook whose thread answers too slowly.
// With the feed gone nothing reopened the gate: the panel stayed click-through
// until the overlay was hidden and shown again.
//
// So, while the gate is shut, main tells the page where the pointer is a few
// times a second (only while the pointer is inside the window's rectangle) and
// the page answers with its usual hit-test. The page remains the only judge of
// what is panel and what is margin; main only makes sure it gets asked.
//
// Pure, no platform branch (see __tests__/OverlayHoverGateProbe2026_10_05.test.mjs).

/** How often main asks while the gate is shut. Well under the time a click takes to follow a move. */
export const HOVER_PROBE_INTERVAL_MS = 100;

export interface HoverProbeConditions {
  /** The overlay window is on screen. */
  visible: boolean;
  /** The user's click-through mode: the window is meant to ignore the mouse. */
  passthrough: boolean;
  /** The page's last verdict: true = pointer over the panel, gate open. */
  hoverInteractive: boolean;
  /** `forward: true` exists on this platform (the hover gate is off without it). */
  forwardSupported: boolean;
}

/** Should main be probing right now? Only while the hover gate itself has the window shut. */
export function shouldProbeHover(c: HoverProbeConditions): boolean {
  return c.visible && c.forwardSupported && !c.passthrough && !c.hoverInteractive;
}

/**
 * The pointer in window coordinates, or null when it is not inside the window.
 * Both inputs are Electron screen coordinates (DIPs), as getCursorScreenPoint()
 * and getBounds() return them on macOS and Windows.
 */
export function hoverProbePoint(
  cursor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number } | null {
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null;
  return { x, y };
}
