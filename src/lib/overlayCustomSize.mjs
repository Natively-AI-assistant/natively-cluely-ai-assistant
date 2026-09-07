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
/**
 * FALLBACK floor for a user-chosen height, used only when the real one cannot
 * be measured. It is no longer the floor itself: the overlay's default state
 * measures 154, below this, and naturalWindowHeightFor supplies the measured
 * value. WindowHelper.OVERLAY_MIN_HEIGHT holds the same number for the same
 * reason (a size that could not be measured), but the two are no longer an
 * invariant pair — neither clamps a size the renderer has actually measured.
 */
export const OVERLAY_MIN_WINDOW_HEIGHT = 216;
/**
 * The MANUAL height floor once there are responses. Auto expand/contract is the
 * primary sizing and never consults this — it reports the content height
 * whenever no height is pinned, and only a manual drag pins one. Chosen so a
 * conversation can be brought back to a usable, scrolling panel: the old floor
 * tracked the auto-grown height, which reaches the 830 display cap after a few
 * exchanges and left the overlay un-shrinkable for the rest of the session.
 */
export const OVERLAY_CONTENT_MIN_WINDOW_HEIGHT = 450;
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
 * The NARROWEST window a manual resize may produce.
 *
 * Resizing is offered in a controlled range, not as free-form dragging: the
 * overlay may be made bigger than the size it gives itself, never smaller. The
 * width half of that rule is a single number, because the OS window is
 * OVERLAY_DEFAULT_WINDOW_WIDTH in BOTH states — the 600↔732 animation moves
 * the panel INSIDE a fixed window (see collapsedWidthFor), it never resizes the
 * window.
 *
 * Stated in panel terms — the widths a user actually sees — the same floor
 * reads as "the collapsed panel never goes below 600, the expanded panel never
 * below 732". Both resolve here: collapsedWidthFor(732) === 600, and an
 * expanded panel IS the window width.
 *
 * Takes the display rather than returning the bare constant so a display too
 * small for the default cannot produce a floor ABOVE its own ceiling — an
 * inverted range would make clamp() return the floor for every drag and pin
 * the overlay wider than the window the main process will ever grant.
 */
export function minWindowWidthFor(availWidth) {
  return Math.min(OVERLAY_DEFAULT_WINDOW_WIDTH, maxWindowWidthFor(availWidth));
}

/**
 * The SHORTEST window a manual resize may produce: the height the overlay
 * would auto-size itself to right now.
 *
 * This is the height half of the controlled range, and it is one rule covering
 * both states the user described:
 *
 *   meeting just started, nothing asked → no scrollable content, so the window
 *                                         IS its chrome (154 as measured)
 *   questions/answers present           → chrome + the full scroll extent, i.e.
 *                                         whatever it auto-grew to
 *
 * Note this is NOT minWindowHeightFor. That one answers a different question —
 * "how short can the shell lay out before the overflow-hidden footer clips",
 * chrome + a 120px usable viewport — and it is strictly TALLER than the empty
 * state it is meant to bound (154 → 274). Using it as the resize floor is what
 * made the first downward drag on an empty overlay jump it 120px taller.
 *
 * Capped at the display budget so a long conversation cannot floor the overlay
 * above the tallest window the main process will grant.
 */
export function naturalWindowHeightFor(params) {
  const { chromeHeight, scrollHeight = 0, maxHeight = OVERLAY_MAX_WINDOW_HEIGHT } = params ?? {};
  // Unmeasurable chrome (shell not mounted, detached node) must fall back to
  // the historical constant rather than floor the overlay at zero height.
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) return OVERLAY_MIN_WINDOW_HEIGHT;
  const scroll = Number.isFinite(scrollHeight) && scrollHeight > 0 ? Math.ceil(scrollHeight) : 0;
  // Ceil, not round: a floor half a pixel short of the content is a floor that
  // clips it.
  const natural = Math.ceil(chromeHeight) + scroll;
  const ceiling = Number.isFinite(maxHeight) ? Math.round(maxHeight) : OVERLAY_MAX_WINDOW_HEIGHT;
  return Math.min(natural, ceiling);
}

// ── Smooth free-form resize ───────────────────────────────────────────────
// A drag is rendered ENTIRELY in CSS inside a pre-grown transparent window:
// one native resize on grab (to the envelope below), one on release (to fit),
// none in between. Every native resize of a transparent, backdrop-blurred
// window re-rasters it, which is why the old per-33ms setBounds stepped the
// visible edge in 40–150px lurches while the toggle button — streamed at
// frame rate — ran ahead of it. The 600↔732 spring has always been smooth for
// exactly this reason: it never touches the native window.

/**
 * The largest window that fits WITHOUT MOVING ITS ORIGIN: grows right and down
 * only, into transparent space, up to the same work-area budget the
 * main-process clamp applies. Stopping at the work-area edge matters more than
 * the budget — a request past the edge makes setOverlayDimensionsAnchored
 * shift X/Y to fit, and an origin move flashes for a frame on macOS because
 * Chromium does not sync setBounds to renderer paint. Never smaller than the
 * window already is: shrinking on grab would clip the panel about to be dragged.
 */
export function resizeEnvelopeFor(params) {
  const { x, y, width, height, workArea, budgetRatio = OVERLAY_WORK_AREA_BUDGET } = params;
  const roomRight = workArea.x + workArea.width - x;
  const roomDown = workArea.y + workArea.height - y;
  const budgetWidth = Math.floor(workArea.width * budgetRatio);
  const budgetHeight = Math.floor(workArea.height * budgetRatio);
  return {
    width: Math.round(Math.max(width, Math.min(budgetWidth, roomRight))),
    height: Math.round(Math.max(height, Math.min(budgetHeight, roomDown))),
  };
}

/**
 * The narrowest the PANEL may be dragged — its default for the current state,
 * stated in the panel widths the user actually sees: 600 collapsed with nothing
 * asked, 732 expanded once there is content. Never above where the drag starts:
 * text-only content leaves the panel collapsed at 600, and a 732 floor there
 * would leap it 132px on the first move (see the jump guard in
 * computeResizeFrame for the height-side twin of this rule).
 */
export function panelWidthFloorFor({ hasContent, startWidth }) {
  const stateDefault = hasContent ? OVERLAY_DEFAULT_WINDOW_WIDTH : OVERLAY_DEFAULT_COLLAPSED_WIDTH;
  return Math.min(stateDefault, Math.round(startWidth));
}

/**
 * The window width that fits a released panel. Never below the default window
 * width — a panel narrower than that centres inside the default, which is the
 * existing collapsed geometry — and never past the display ceiling.
 */
export function releaseWindowWidthFor(panelWidth, availWidth) {
  return clamp(Math.round(panelWidth), minWindowWidthFor(availWidth), maxWindowWidthFor(availWidth));
}

/**
 * The SHORTEST a manual drag may make the window, for the current state:
 *
 *   meeting just started, nothing asked → the chrome height (154 measured): the
 *                                         window IS its chrome, the default state
 *   responses present                   → OVERLAY_CONTENT_MIN_WINDOW_HEIGHT, but
 *                                         never below the chrome (that clips the
 *                                         footer) nor above the display budget
 *
 * computeResizeFrame additionally bounds this by where the drag starts, so a
 * chat that has only grown to 298 cannot be dragged below 298 — 450 only
 * matters once the conversation has grown past it. Auto sizing is untouched.
 */
export function manualHeightFloorFor({ hasContent, chromeHeight, maxHeight }) {
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) return OVERLAY_MIN_WINDOW_HEIGHT;
  const chrome = Math.ceil(chromeHeight);
  const floor = hasContent ? Math.max(OVERLAY_CONTENT_MIN_WINDOW_HEIGHT, chrome) : chrome;
  const ceiling = Number.isFinite(maxHeight) ? Math.round(maxHeight) : OVERLAY_MAX_WINDOW_HEIGHT;
  return Math.min(floor, ceiling);
}

/**
 * Bring a size that was persisted under different conditions inside the floors
 * and ceilings that apply NOW — an older build's 360px width floor, or a
 * display larger than the one the app has just opened on.
 *
 * A null axis means "not pinned" and stays null: it is the absence of a choice,
 * not a zero to be clamped up to the floor.
 */
export function clampCustomOverlaySize(size, bounds) {
  const { minWidth, minHeight, maxWidth, maxHeight } = bounds ?? {};
  return {
    width: clampPinnedAxis(size?.width, minWidth, maxWidth),
    height: clampPinnedAxis(size?.height, minHeight, maxHeight),
  };
}

/**
 * One axis of clampCustomOverlaySize. Preserves null, and bounds each side
 * INDEPENDENTLY: at mount the height floor is not yet knowable (nothing is laid
 * out, so there is no chrome to measure) while the ceiling already is, and a
 * both-or-nothing clamp would silently drop the ceiling along with the floor.
 * Floor applied last, so an inverted pair yields the floor — matching
 * computeResizeFrame.
 */
function clampPinnedAxis(value, lo, hi) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  let out = Math.round(value);
  if (Number.isFinite(hi)) out = Math.min(out, Math.round(hi));
  if (Number.isFinite(lo)) out = Math.max(out, Math.round(lo));
  return out;
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
    // Like minHeight, a CALLER-SUPPLIED floor rather than a constant: the
    // controlled range is anchored to the size the overlay gives itself on the
    // display it is actually on (minWindowWidthFor). Defaults to the historical
    // constant so a caller that does not pass one is unaffected.
    minWidth = OVERLAY_MIN_WINDOW_WIDTH,
    // The floor is a CALLER-SUPPLIED measurement, not a constant: the shell is
    // overflow-hidden, so its real minimum is (measured chrome + a usable
    // scroll viewport). A fixed 216 floor lets a tall-chrome build be dragged
    // shorter than its own footer and clip it.
    minHeight = OVERLAY_MIN_WINDOW_HEIGHT,
  } = params;
  // A MEASURED floor wins outright; OVERLAY_MIN_WINDOW_HEIGHT is only the
  // fallback for callers that supply none. It cannot be a max() against 216:
  // the overlay's own default state is 154 tall, so clamping the floor up to
  // 216 would forbid returning to the very size the rule names as the minimum.
  const requestedHeightFloor =
    Number.isFinite(minHeight) && minHeight > 0
      ? Math.round(minHeight)
      : OVERLAY_MIN_WINDOW_HEIGHT;
  // A floor ABOVE where the drag starts is not a floor, it is a jump. The
  // height is clamped even on a width-only drag (it passes through), so the
  // first move past the drag threshold would snap the window up to the floor —
  // and pinsHeightFor('e', alreadyPinned) would then PERSIST that snap.
  //
  // This is reachable whenever the window is deliberately shorter than its
  // natural height: a pinned height is NOT lifted when content grows past it
  // (the chat scrolls inside the size the user chose), so a 298px pin with a
  // 2000px scroll extent yields a natural floor of 830 against a startHeight of
  // 298 — a 532px leap on the first move. Bounding by startHeight keeps the
  // rule ("never shorter than the size it gave itself") and adds the half that
  // makes it coherent with leaving pins alone: never shorter than it already
  // is, either.
  const heightFloor = Math.min(requestedHeightFloor, Math.round(startHeight));
  const widthFloor =
    Number.isFinite(minWidth) && minWidth > 0 ? Math.round(minWidth) : OVERLAY_MIN_WINDOW_WIDTH;
  const widthDriven = direction === 'e' || direction === 'se';
  const heightDriven = direction === 's' || direction === 'se';
  return {
    width: clamp(
      Math.round(widthDriven ? startWidth + dx : startWidth),
      widthFloor,
      Math.max(widthFloor, maxWidth),
    ),
    height: clamp(
      Math.round(heightDriven ? startHeight + dy : startHeight),
      heightFloor,
      Math.max(heightFloor, maxHeight),
    ),
  };
}
