// src/components/onboarding/genieMotion.mjs
//
// The macOS genie: a card that pours through a funnel into a slot at the
// bottom centre of the window, the way a minimised window pours into its Dock
// icon, and back out again.
//
// The funnel is fixed on screen, running from the card down to the slot. The
// card moves through it rather than carrying the shape with it. That is what
// makes it read as the real thing.
//
// One progress value p drives everything:
//   p = 0   the card, whole and at rest
//   p = 1   the card, gone into the slot
//
// Two overlapping phases, as on macOS:
//   stretch  (p 0 → 0.45)  the funnel forms and the card's bottom edge
//                          reaches down into the slot, stretching the card
//   drain    (p 0.3 → 1)   the top edge follows it down, narrowing as it
//                          passes through the funnel, until it lands
//
// Pure functions of p and the measured geometry, with no DOM access, so the
// tests run them directly.

/** Slot width in px: about the width of a Dock icon. */
export const SLOT_WIDTH = 40;

/** How far above the window's bottom edge the slot sits, in px. */
export const SLOT_INSET = 6;

/** Points sampled down each side of the silhouette. */
const SAMPLES = 20;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);

/** Stretch phase, eased: 0 at rest, 1 once the bottom edge is in the slot. */
export function genieStretch(p) {
  return smooth(clamp01(p / 0.45));
}

/** Drain phase, eased: 0 at rest, 1 once the top edge is in the slot. */
export function genieDrain(p) {
  return smooth(clamp01((p - 0.3) / 0.7));
}

/**
 * Where the card's top and bottom edges are on screen, and where the slot is.
 * geom: { top, bottom, width, slotY } in px, measured at rest.
 */
export function genieEdges(p, geom) {
  const stretch = genieStretch(p);
  const drain = genieDrain(p);
  const top = geom.top + (geom.slotY - geom.top) * drain;
  const bottom = geom.bottom + (geom.slotY - geom.bottom) * stretch;
  return { top, bottom: Math.max(bottom, top) };
}

/**
 * Half-width of the funnel, in px, at screen height y. It narrows along an
 * S-curve from the card's full width near its top down to the slot, and it
 * forms gradually: at rest it is simply the card.
 */
export function genieHalfWidthAt(p, geom, y) {
  const full = geom.width / 2;
  const slot = SLOT_WIDTH / 2;
  const along = clamp01((y - geom.top) / Math.max(1, geom.slotY - geom.top));
  // The top tenth holds its width, so the upper corners stay square.
  const k = smooth(clamp01((along - 0.1) / 0.9));
  const funnel = full + (slot - full) * k;
  return full + (funnel - full) * genieStretch(p);
}

/** Opacity: solid until the last tenth, then it lands and is gone. */
export function genieOpacity(p) {
  return p < 0.9 ? 1 : clamp01((1 - p) / 0.1);
}

/**
 * Everything the card needs for frame p:
 *   transform  translate + vertical stretch, with transform-origin at the top
 *   clipPath   the funnel, in the card's own coordinates
 *   opacity
 */
export function genieFrame(p, geom) {
  if (p <= 0.001 || !geom || geom.width <= 0 || geom.bottom <= geom.top) {
    return { transform: 'none', clipPath: 'none', opacity: 1 };
  }
  const height = geom.bottom - geom.top;
  const { top, bottom } = genieEdges(p, geom);
  const span = Math.max(bottom - top, 0.5);
  const scaleY = span / height;

  const right = [];
  const left = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    const half = genieHalfWidthAt(p, geom, top + u * span);
    const dx = (half / geom.width) * 100;
    const y = (u * 100).toFixed(2);
    right.push(`${(50 + dx).toFixed(2)}% ${y}%`);
    left.unshift(`${(50 - dx).toFixed(2)}% ${y}%`);
  }

  return {
    transform: `translateY(${(top - geom.top).toFixed(2)}px) scaleY(${scaleY.toFixed(4)})`,
    clipPath: `polygon(${right.concat(left).join(', ')})`,
    opacity: genieOpacity(p),
  };
}

/**
 * CSS matrix3d that maps a w x h box (transform-origin 0 0) onto the
 * quadrilateral with corners, in order, top-left, top-right, bottom-right,
 * bottom-left. A projective map, not an affine one: that is what lets a
 * rectangle become a trapezoid, so neighbouring bands meet along a shared
 * edge and the content runs across the seam unbroken. (Heckbert's
 * square-to-quad, scaled to the box.)
 */
export function quadMatrix3d(w, h, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, k;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0;
    d = y1 - y0; e = y2 - y1; f = y0;
    g = 0; k = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    k = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + k * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + k * y3; f = y0;
  }
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, c, f, 0, 1];
  // Significant figures, not decimal places: the perspective terms are tiny.
  return `matrix3d(${m.map(v => +v.toPrecision(10)).join(',')})`;
}

/**
 * The card cut into horizontal bands, each mapped onto its own slice of the
 * funnel, so the content pinches with the silhouette instead of being
 * cropped by it.
 *
 * Bands are whole pixels tall, cut at whole-pixel rows. A band cut at a
 * fractional row is rasterised with a half-covered edge, and that edge shows
 * as a faint line across the card, so the heights are rounded rather than
 * split evenly. Band i covers card rows [y0, y1] in px. It is a container,
 * overflow hidden, placed at top = y0 and holding a copy of the card offset
 * by -y0. Its transform, with transform-origin 0 0, maps it onto the
 * trapezoid between its two screen rows. Adjacent bands share those rows
 * exactly, so there is no seam and no step, in the outline or the content.
 *
 * Each container should be drawn BAND_OVERLAP px taller than its band. The
 * extra rows sit under the next band and cover its anti-aliased top edge.
 */
export const BAND_OVERLAP = 2;

/** The bands' row ranges in px, about `count` of them, whole pixels each. */
export function genieBandRows(height, count) {
  const step = Math.max(2, Math.round(height / count));
  const rows = [];
  for (let y = 0; y < height; y += step) rows.push([y, Math.min(height, y + step)]);
  return rows;
}

export function genieBands(p, geom, rows) {
  const width = geom.width;
  const height = geom.bottom - geom.top;
  const { top, bottom } = genieEdges(p, geom);
  const span = Math.max(bottom - top, 0.5);
  const cx = width / 2;
  return rows.map(([r0, r1]) => {
    const y0 = top + (r0 / height) * span;
    const y1 = top + (r1 / height) * span;
    const h0 = genieHalfWidthAt(p, geom, y0);
    const h1 = genieHalfWidthAt(p, geom, y1);
    // Corners in the band's own frame: x from the card's left edge, y from
    // where the band sits at rest.
    const t = y0 - (geom.top + r0);
    const b = y1 - (geom.top + r0);
    return quadMatrix3d(width, r1 - r0, [[cx - h0, t], [cx + h0, t], [cx + h1, b], [cx - h1, b]]);
  });
}
