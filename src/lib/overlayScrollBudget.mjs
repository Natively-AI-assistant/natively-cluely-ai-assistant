/**
 * Pure helpers for bounding the overlay chat scroll area by the available
 * VERTICAL budget — not just the shell width (unit-tested).
 *
 * Why this exists
 * ---------------
 * The overlay is sized-to-content: the renderer reports `contentRef.offsetHeight`
 * to the main process, which clamps the OS window to `workArea.height * 0.9`
 * (WindowHelper.setOverlayDimensionsCentered). The shell is `overflow-hidden`.
 *
 * The chat scroll area's max height used to be derived from the shell WIDTH
 * alone (320px collapsed → 560px expanded). On a short display, expanded view
 * + an attached screenshot makes
 *     chrome (TopPill + quick-actions + input + footer + paddings) + 560
 * exceed the 90% budget. The window gets clamped, but the taller-than-window
 * content is still laid out, so the bottom rows (model selector / settings /
 * send button) are cropped past the clamped window edge.
 *
 * Fix: also clamp the scroll max by `budget - chrome`, so the scroll area
 * shrinks to absorb the overflow and the reported content height never exceeds
 * the budget the main process will grant. The footer then always stays visible.
 */

/** Clamp n into [lo, hi]. */
export function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * The width-derived scroll max: a linear interpolation between the collapsed
 * and expanded maxima as the shell animates 600 ↔ 780. This is the AESTHETIC
 * upper bound (how tall the chat is allowed to get on a roomy display).
 */
export function widthDerivedScrollMax(width, opts = {}) {
  const {
    collapsedWidth = 600,
    expandedWidth = 780,
    minHeight = 320,
    maxHeight = 560,
  } = opts;
  if (expandedWidth <= collapsedWidth) return maxHeight;
  const t = clamp((width - collapsedWidth) / (expandedWidth - collapsedWidth), 0, 1);
  return minHeight + t * (maxHeight - minHeight);
}

/**
 * The vertical budget cap: the tallest the scroll area may be so that the WHOLE
 * content (chrome + scroll) still fits inside `availHeight * budgetRatio`,
 * mirroring the main-process clamp. `chromeHeight` is every non-scroll pixel
 * (TopPill, gap, status pills, quick-actions, input area, footer, paddings).
 *
 * A small `safetyMargin` keeps us strictly under the floored main-process
 * budget so a sub-pixel rounding never reintroduces a 1px clip. Floored to
 * `minScroll` so the scroll viewport never collapses to nothing on a
 * pathologically short display (clipping a little history is better than a
 * zero-height — and far better than clipping the footer).
 */
export function verticalScrollCap(params) {
  const {
    availHeight,
    chromeHeight,
    budgetRatio = 0.9,
    safetyMargin = 8,
    minScroll = 120,
  } = params;
  if (!Number.isFinite(availHeight) || availHeight <= 0) return Infinity;
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) return Infinity;
  const budget = Math.floor(availHeight * budgetRatio) - safetyMargin;
  return Math.max(budget - chromeHeight, minScroll);
}

/**
 * Final scroll max height = the smaller of the width-derived aesthetic bound
 * and the vertical budget cap. On a tall display the width bound wins (chat
 * looks the same as before); on a short display the vertical cap kicks in and
 * the footer stays on screen.
 */
export function computeScrollMaxHeight(params) {
  const { width, availHeight, chromeHeight } = params;
  const widthBound = widthDerivedScrollMax(width, params);
  const vBound = verticalScrollCap({ availHeight, chromeHeight, ...params });
  return Math.min(widthBound, vBound);
}
