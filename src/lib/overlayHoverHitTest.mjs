// Pure hit-test for the overlay's hover-gated click-through.
//
// The overlay OS window is a FIXED WIDTH (780) that is WIDER than its painted
// panel when the shell is collapsed (600), so there are transparent side-margins
// that must pass clicks through to the app behind rather than swallowing them as
// dead clicks. The renderer tracks the pointer and asks this function: given the
// painted content's bounding rect and the pointer position, is the pointer over
// the painted content (window should capture clicks) or not (window should be
// click-through)?
//
// Pure + dependency-free so it is unit-testable without a DOM. The renderer
// passes `contentRef.current.getBoundingClientRect()` and the pointer's
// client coordinates.

/**
 * @typedef {Object} Rect
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * Is the pointer over the painted content rect (inclusive of edges)?
 *
 * @param {Rect | null | undefined} rect  the painted content's client rect
 * @param {number} x  pointer clientX
 * @param {number} y  pointer clientY
 * @returns {boolean} true → over content (capture clicks); false → margin/outside
 */
export function isPointerOverContent(rect, x, y) {
  if (!rect) return false;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    Number.isNaN(x) ||
    Number.isNaN(y)
  ) {
    return false;
  }
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
