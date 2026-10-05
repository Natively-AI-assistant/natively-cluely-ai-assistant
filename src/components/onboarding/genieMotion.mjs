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
  const k = genieSide(clamp01((along - 0.1) / 0.9));
  const funnel = full + (slot - full) * k;
  return full + (funnel - full) * genieStretch(p);
}

/**
 * How long the handles of each funnel side's Bezier are, as a share of the
 * funnel's height. A side is a cubic Bezier from the card's edge down to the
 * slot's, leaving the card straight down and arriving at the slot straight
 * down (vertical tangents at both ends), the curve macOS draws. Handles of a
 * third make it exactly smoothstep; macOS's are longer: the card holds its
 * width further down, then necks in more decisively, a deeper S.
 */
export const SIDE_HANDLE = 0.55;

/**
 * The side curve: at `u` of the way down the funnel (0 at its top, 1 at the
 * slot), how far the side has moved in from the card's edge to the slot's
 * (0..1). The Bezier's control points in (inward, down) are (0, 0),
 * (0, SIDE_HANDLE), (1, 1 - SIDE_HANDLE), (1, 1); `u` gives the height, so
 * the Bezier's parameter is solved for it (monotone: bisection, 24 steps is
 * well under a hundredth of a pixel).
 */
export function genieSide(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const h = SIDE_HANDLE;
  const down = t => 3 * (1 - t) * (1 - t) * t * h + 3 * (1 - t) * t * t * (1 - h) + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (down(mid) < u) lo = mid; else hi = mid;
  }
  const t = (lo + hi) / 2;
  // Inward: control points 0, 0, 1, 1.
  return 3 * (1 - t) * t * t + t * t * t;
}

/** Opacity: solid until the last tenth, then it lands and is gone. */
export function genieOpacity(p) {
  return p < 0.9 ? 1 : clamp01((1 - p) / 0.1);
}

/**
 * How far in, in px, the silhouette may pinch before the card's shadow has
 * gone. The shadow is a rectangle's box-shadow, cut off at the rectangle's
 * edge, so while it shows it draws the rectangle's outline: wherever the card
 * has pinched in from it, that outline stands around the card, the finished
 * border there before the card is. Faded out over this much pinch, the most
 * that outline can stray from the card is a quarter of it: 1.5 px, a few
 * frames at the start of a close and the end of an open. (macOS and the
 * GNOME port drop the shadow in flight altogether.)
 */
export const SHADOW_PINCH_PX = 6;

/**
 * The shadow stand-in's opacity at p: whole while the card is a rectangle,
 * gone once it has pinched in SHADOW_PINCH_PX at its bottom edge, where the
 * funnel narrows most. Measured in px, not in progress, so a narrow card or a
 * corner notice on a short funnel fades its shadow over the same visible
 * change as a wide one. Never later than the stretch (a card too narrow to
 * pinch still loses it on the way down).
 */
export function genieShadowOpacity(p, geom) {
  const { bottom } = genieEdges(p, geom);
  const pinch = geom.width / 2 - genieHalfWidthAt(p, geom, bottom);
  return Math.min(1 - genieStretch(p), clamp01(1 - pinch / SHADOW_PINCH_PX));
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

/**
 * The genie as a precomputed track, for the compositor to play.
 *
 * Driven from JavaScript, every frame of the genie is a main-thread write, and
 * a popup opening is exactly when the main thread is busiest (the card
 * mounting, its data landing). Blocks of 40 ms every 100 ms cost the pour 6
 * of its ~33 frames: a hitch every tenth of a second. Handed to the
 * compositor as Web Animations, the motion keeps going while the main thread
 * is blocked.
 *
 * The samples are dense (120 a second) so the browser's blend between two
 * neighbours stays tiny. It blends a matrix3d by decomposing it, which for
 * these projective maps is not a straight line, so two neighbouring bands
 * drift apart a little between samples; 8 ms apart that drift stays inside
 * the bands' BAND_OVERLAP. (Holding each sample instead, steps(1, end),
 * made a 60 Hz display advance one sample on some frames and three on
 * others: uneven motion.)
 *
 *   from, to     genie progress at the start and end (1 = in the slot)
 *   ease         t -> eased t, for the whole run
 *   durationMs   length of the run
 *   geom, rows   as for genieBands
 *
 * Returns keyframe offsets and, per offset, every band's transform, the band
 * layer's opacity and the shadow stand-in's transform and opacity.
 */
export function genieTrack(from, to, ease, durationMs, geom, rows, hz = 120) {
  const n = Math.max(2, Math.ceil((durationMs / 1000) * hz) + 1);
  const offsets = [];
  const bands = rows.map(() => []);
  const layerOpacity = [];
  const shadowTransform = [];
  const shadowOpacity = [];
  const height = geom.bottom - geom.top;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = from + (to - from) * ease(t);
    offsets.push(t);
    genieBands(p, geom, rows).forEach((m, b) => bands[b].push(m));
    layerOpacity.push(genieOpacity(p));
    const { top, bottom } = genieEdges(p, geom);
    const sy = Math.max(bottom - top, 0.5) / height;
    shadowTransform.push(`translateY(${(top - geom.top).toFixed(2)}px) scaleY(${sy.toFixed(4)})`);
    shadowOpacity.push(genieShadowOpacity(p, geom));
  }
  return { offsets, bands, layerOpacity, shadowTransform, shadowOpacity };
}
