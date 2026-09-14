/**
 * Pure geometry for the Windows stealth caret.
 *
 * WHY A SYNTHETIC CARET EXISTS AT ALL
 *
 * On macOS the overlay chat input holds real DOM focus — the window is an
 * NSPanel that can become key without activating Natively — so Chromium draws
 * the caret itself and this module is never used. On Windows the overlay is
 * WS_EX_NOACTIVATE (see electron/utils/windowsFocusPolicy.ts) and is NEVER
 * focused: text arrives from the native WH_KEYBOARD_LL hook and is written
 * straight into React state. An unfocused input draws no caret, so the box sat
 * there looking dead while the user typed into it.
 *
 * WHY END-ANCHORED IS CORRECT, NOT AN APPROXIMATION
 *
 * The insertion point on this path can only ever be the end of the string.
 * `is_passthrough_vk` in native-module/src/keyboard_hook_windows.rs hands Left,
 * Right, Home, End, Insert and Delete to the FOREGROUND app — they never reach
 * the renderer — and the only editing key that does reach it is Backspace,
 * which the renderer implements as `value.slice(0, -1)`. So nothing in the
 * Windows input path can move an insertion point off the end, and a caret
 * pinned there is exact rather than a simplification.
 *
 * (That is also a real macOS-parity gap worth knowing about: a macOS user can
 * arrow back into the middle of their question and edit it; a Windows user
 * cannot. Fixing that means giving the hook a selection model, which is a much
 * larger change than drawing a caret.)
 */

/**
 * Horizontal offset, in CSS pixels from the input's border box, at which to
 * draw the caret.
 *
 * @param {object} m
 * @param {number} m.textWidth    Rendered width of the current value.
 * @param {number} m.paddingLeft  The input's left padding.
 * @param {number} m.contentWidth Visible text area (clientWidth - both paddings).
 * @returns {number}
 */
export function computeStealthCaretLeft({ textWidth, paddingLeft, contentWidth }) {
  const pad = Number.isFinite(paddingLeft) ? Math.max(0, paddingLeft) : 0;
  const content = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const text = Number.isFinite(textWidth) ? Math.max(0, textWidth) : 0;

  // Once the text is wider than the box, the input is scrolled to its end (the
  // component drives scrollLeft, because an UNFOCUSED input never auto-scrolls
  // to reveal the caret the way a focused one does). The tail of the string is
  // therefore flush against the right edge of the content area, and that is
  // where the caret belongs — not at `pad + text`, which would be off-screen.
  return pad + Math.min(text, content);
}

/**
 * Measure a string against a CSS `font` shorthand using a cached 2D context.
 *
 * Canvas rather than a hidden mirror <span>: measuring here must not touch the
 * DOM. This runs on every keystroke, and a mirror node would force a style
 * recalc + layout on the overlay's subtree each time — on the one surface that
 * must stay smooth while the user is mid-meeting.
 *
 * @param {string} text
 * @param {string} font CSS font shorthand, e.g. from getComputedStyle(el).font
 * @returns {number} width in CSS pixels; 0 if canvas is unavailable
 */
let measureCtx = null;
export function measureTextWidth(text, font) {
  if (!text) return 0;
  try {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
    }
    if (!measureCtx) return 0;
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  } catch {
    // Canvas blocked / unavailable — a caret parked at the text start is a far
    // better failure than throwing inside the overlay's render path.
    return 0;
  }
}
