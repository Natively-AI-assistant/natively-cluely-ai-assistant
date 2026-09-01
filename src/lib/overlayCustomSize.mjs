/**
 * Pure helpers for the overlay's USER-CHOSEN window size (unit-tested).
 *
 * Why this exists
 * ---------------
 * The overlay OS window has historically been a FIXED width (732 =
 * WindowHelper.OVERLAY_DEFAULT_WIDTH), with the panel animating 600↔732 purely
 * in CSS, centered inside it. That invariant is load-bearing: three separate
 * subsystems derive their geometry from "the window is 732 wide" —
 *
 *   1. the toggle aux window's anchor      (panelRight = (windowW + panelW) / 2)
 *   2. the settings/model popover margin   (WindowHelper.getOverlayPanelLeftMargin)
 *   3. the click-through hover gate        (margin = (windowW - panelW) / 2)
 *
 * — and a width setBounds on a transparent, backdrop-blurred window re-rasters
 * and flickers on macOS, because Chromium does not sync setBounds to renderer
 * paint.
 *
 * Making the overlay user-resizable does NOT mean giving up that invariant. It
 * means the window width becomes a value the user can change (rarely, by
 * dragging) instead of a compile-time constant — and every one of the three
 * consumers above reads that same value. Within a session the width is still
 * fixed for the entire expand/collapse spring, so there is still no width
 * setBounds during an animation. That is what these helpers encode.
 *
 * Everything here is pure so the geometry can be tested without a display:
 * see src/lib/__tests__/overlayCustomSize.test.mjs.
 */

/** The window's birth width. MUST equal WindowHelper.OVERLAY_DEFAULT_WIDTH. */
export const OVERLAY_DEFAULT_WINDOW_WIDTH = 732;
/** The panel's collapsed width at the DEFAULT window width. */
export const OVERLAY_DEFAULT_COLLAPSED_WIDTH = 600;
/** Floor for a user-chosen width — below this the footer chrome cannot lay out. */
export const OVERLAY_MIN_WINDOW_WIDTH = 360;
/** Floor for a user-chosen height. MUST equal WindowHelper.OVERLAY_MIN_HEIGHT. */
export const OVERLAY_MIN_WINDOW_HEIGHT = 216;
/** Absolute sanity ceilings, applied before any display-derived clamp. */
export const OVERLAY_MAX_WINDOW_WIDTH = 2560;
export const OVERLAY_MAX_WINDOW_HEIGHT = 2560;

/**
 * The fraction of the work area the MAIN PROCESS will grant
 * (WindowHelper.setOverlayDimensionsAnchored clamps to floor(workArea * 0.9)).
 * The renderer mirrors it so a drag stops exactly where the window will stop,
 * instead of racing past the clamp and persisting a width that can never be
 * applied.
 */
export const OVERLAY_WORK_AREA_BUDGET = 0.9;

export const CUSTOM_WIDTH_STORAGE_KEY = 'natively_custom_overlay_width';
export const CUSTOM_HEIGHT_STORAGE_KEY = 'natively_custom_overlay_height';

/** Clamp n into [lo, hi]. */
export function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Parse one persisted dimension. Returns null for absent, blank, non-numeric,
 * or out-of-range values — a corrupt localStorage entry must fall back to the
 * default geometry, never poison the window size.
 */
export function parseStoredDimension(raw, lo, hi) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < lo || rounded > hi) return null;
  return rounded;
}

/**
 * Read the persisted custom size. `storage` is any localStorage-like object;
 * a throwing or absent storage (private mode, denied site data) yields the
 * default geometry rather than an exception.
 *
 * Width and height are independent: a user may have pinned only one.
 */
export function readCustomOverlaySize(storage) {
  const result = { width: null, height: null };
  if (!storage) return result;
  try {
    result.width = parseStoredDimension(
      storage.getItem(CUSTOM_WIDTH_STORAGE_KEY),
      OVERLAY_MIN_WINDOW_WIDTH,
      OVERLAY_MAX_WINDOW_WIDTH,
    );
    result.height = parseStoredDimension(
      storage.getItem(CUSTOM_HEIGHT_STORAGE_KEY),
      OVERLAY_MIN_WINDOW_HEIGHT,
      OVERLAY_MAX_WINDOW_HEIGHT,
    );
  } catch {
    return { width: null, height: null };
  }
  return result;
}

/**
 * Persist a custom size. A `null` dimension means "not pinned" and REMOVES that
 * key, so widening the overlay with the east handle does not silently freeze
 * its height as well — the two axes are pinned independently, by the handle
 * that actually drove them.
 *
 * Returns true only if the writes landed — a denied or quota-exhausted storage
 * is reported, not swallowed, so the caller can tell the user the size is
 * session-only.
 */
export function writeCustomOverlaySize(storage, size) {
  if (!storage) return false;
  try {
    if (size.width === null || size.width === undefined) {
      storage.removeItem(CUSTOM_WIDTH_STORAGE_KEY);
    } else {
      storage.setItem(CUSTOM_WIDTH_STORAGE_KEY, String(Math.round(size.width)));
    }
    if (size.height === null || size.height === undefined) {
      storage.removeItem(CUSTOM_HEIGHT_STORAGE_KEY);
    } else {
      storage.setItem(CUSTOM_HEIGHT_STORAGE_KEY, String(Math.round(size.height)));
    }
    return true;
  } catch {
    return false;
  }
}

/** Forget the custom size — the overlay returns to auto-sizing. */
export function clearCustomOverlaySize(storage) {
  if (!storage) return false;
  try {
    storage.removeItem(CUSTOM_WIDTH_STORAGE_KEY);
    storage.removeItem(CUSTOM_HEIGHT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The shortest the overlay may be dragged, given how tall its non-scrolling
 * chrome currently measures. Below this the overflow-hidden shell would lay out
 * taller than its own window and clip the footer.
 */
export function minWindowHeightFor(chromeHeight, minScroll = 120) {
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) return OVERLAY_MIN_WINDOW_HEIGHT;
  return Math.max(OVERLAY_MIN_WINDOW_HEIGHT, Math.ceil(chromeHeight) + minScroll);
}

/**
 * The widest window the main process will actually grant on this display,
 * mirroring WindowHelper's floor(workArea.width * 0.9) clamp. Falls back to the
 * absolute ceiling when the display size is unknown (the main process clamps
 * again regardless, and the applied size is echoed back).
 */
export function maxWindowWidthFor(availWidth) {
  if (!Number.isFinite(availWidth) || availWidth <= 0) return OVERLAY_MAX_WINDOW_WIDTH;
  return clamp(
    Math.floor(availWidth * OVERLAY_WORK_AREA_BUDGET),
    OVERLAY_MIN_WINDOW_WIDTH,
    OVERLAY_MAX_WINDOW_WIDTH,
  );
}

/** Height counterpart of maxWindowWidthFor. */
export function maxWindowHeightFor(availHeight) {
  if (!Number.isFinite(availHeight) || availHeight <= 0) return OVERLAY_MAX_WINDOW_HEIGHT;
  return clamp(
    Math.floor(availHeight * OVERLAY_WORK_AREA_BUDGET),
    OVERLAY_MIN_WINDOW_HEIGHT,
    OVERLAY_MAX_WINDOW_HEIGHT,
  );
}

/**
 * The panel's COLLAPSED width for a given window width.
 *
 * Scaled proportionally rather than pinned at the historical 600, so the
 * transparent side margin keeps the same ratio the hover gate and the aux
 * window anchor were tuned for. A user who widens the overlay to 1200 gets a
 * proportionally wider collapsed panel (984) rather than a 600px panel adrift
 * in 300px of dead margin on each side.
 *
 * At the default 732 this returns exactly 600, so the default path is
 * bit-identical to the pre-resize behaviour.
 */
export function collapsedWidthFor(windowWidth) {
  const ratio = OVERLAY_DEFAULT_COLLAPSED_WIDTH / OVERLAY_DEFAULT_WINDOW_WIDTH;
  return clamp(
    Math.round(windowWidth * ratio),
    Math.min(OVERLAY_MIN_WINDOW_WIDTH, windowWidth),
    windowWidth,
  );
}

/**
 * Does this drag PIN the window height?
 *
 * Only a height-driving direction does — or a drag that started with the height
 * already pinned. This matters because computeResizeFrame also CLAMPS the
 * pass-through height to the display budget, so an east-only drag that starts
 * taller than that budget produces a changed height without the user ever
 * having asked for a height pin. Treating that as a pin would freeze the
 * overlay's height as a side effect of merely widening it.
 */
export function pinsHeightFor(direction, heightAlreadyPinned) {
  return Boolean(heightAlreadyPinned) || direction === 's' || direction === 'se';
}

/**
 * Geometry for one pointer-move frame of a resize drag.
 *
 * Only EAST-side directions exist ('e', 's', 'se'). West-side handles would
 * need the window's X origin to move, which setOverlayDimensionsAnchored
 * deliberately never does (an X move flashes for a frame on macOS because
 * Chromium does not sync setBounds to paint). Growing rightward from a
 * left-anchored window is the only direction that is artifact-free, so those
 * are the only handles offered.
 */
export function computeResizeFrame(params) {
  const {
    direction,
    dx,
    dy,
    startWidth,
    startHeight,
    maxWidth = OVERLAY_MAX_WINDOW_WIDTH,
    maxHeight = OVERLAY_MAX_WINDOW_HEIGHT,
    // The floor is a CALLER-SUPPLIED measurement, not a constant: the shell is
    // overflow-hidden, so its real minimum is (measured chrome + a usable
    // scroll viewport). A fixed 216 floor lets a tall-chrome build be dragged
    // shorter than its own footer and clip it.
    minHeight = OVERLAY_MIN_WINDOW_HEIGHT,
  } = params;
  const heightFloor = Math.max(OVERLAY_MIN_WINDOW_HEIGHT, Math.round(minHeight));
  const widthDriven = direction === 'e' || direction === 'se';
  const heightDriven = direction === 's' || direction === 'se';
  return {
    width: clamp(
      Math.round(widthDriven ? startWidth + dx : startWidth),
      OVERLAY_MIN_WINDOW_WIDTH,
      Math.max(OVERLAY_MIN_WINDOW_WIDTH, maxWidth),
    ),
    height: clamp(
      Math.round(heightDriven ? startHeight + dy : startHeight),
      heightFloor,
      Math.max(heightFloor, maxHeight),
    ),
  };
}
