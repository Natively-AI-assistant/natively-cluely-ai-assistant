// The overlay's attached images (screenshots, phone images, and the formula
// images a page capture brings, #645), kept to what one answer request takes.

export const MAX_ATTACHMENTS = 5;

/**
 * `tray` with `item` added. A capture's formula images replace any earlier
 * capture's: both are numbered from 1. When the tray is over `max`, formula
 * images go first, the last one first, so they never push out the user's own
 * images; with none left, the oldest image goes, as before.
 *
 * @template {{ path: string; formulaCapture?: string }} T
 * @param {T[]} tray
 * @param {T} item
 * @param {number} [max]
 * @returns {T[]}
 */
export function addAttachment(tray, item, max = MAX_ATTACHMENTS) {
  if (tray.some((s) => s.path === item.path)) return tray;
  const kept = item.formulaCapture
    ? tray.filter((s) => !s.formulaCapture || s.formulaCapture === item.formulaCapture)
    : tray;
  const next = [...kept, item];
  while (next.length > max) {
    let i = next.length - 1;
    while (i >= 0 && !next[i].formulaCapture) i--;
    next.splice(i >= 0 ? i : 0, 1);
  }
  return next;
}

/**
 * `tray` without formula images: a new page capture replaces the page text
 * an earlier capture's images belong to, whether or not it brings its own.
 *
 * @template {{ path: string; formulaCapture?: string }} T
 * @param {T[]} tray
 * @returns {T[]}
 */
export function withoutFormulaImages(tray) {
  return tray.some((s) => s.formulaCapture) ? tray.filter((s) => !s.formulaCapture) : tray;
}

/**
 * Whether an attached image should show the overlay. A capture taken here
 * does, so the user sees it land; one the phone asked for or sent is `quiet`,
 * because the phone is the screen in use and the overlay popping up on the
 * desktop is exactly what it is there to avoid.
 *
 * @param {{ quiet?: boolean }} item
 * @returns {boolean}
 */
export function revealsOverlay(item) {
  return item.quiet !== true;
}
