import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAY_DEFAULT_WINDOW_WIDTH,
  OVERLAY_DEFAULT_COLLAPSED_WIDTH,
  OVERLAY_MIN_WINDOW_WIDTH,
  OVERLAY_MIN_WINDOW_HEIGHT,
  OVERLAY_MAX_WINDOW_WIDTH,
  CUSTOM_WIDTH_STORAGE_KEY,
  CUSTOM_HEIGHT_STORAGE_KEY,
  parseStoredDimension,
  readCustomOverlaySize,
  writeCustomOverlaySize,
  clearCustomOverlaySize,
  maxWindowWidthFor,
  maxWindowHeightFor,
  minWindowHeightFor,
  collapsedWidthFor,
  pinsHeightFor,
  computeResizeFrame,
  minWindowWidthFor,
  naturalWindowHeightFor,
  clampCustomOverlaySize,
  resizeEnvelopeFor,
  panelWidthFloorFor,
  releaseWindowWidthFor,
  manualHeightFloorFor,
  OVERLAY_CONTENT_MIN_WINDOW_HEIGHT,
} from '../overlayCustomSize.mjs';

/** Minimal in-memory localStorage stand-in. */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

/** A storage that throws on every access (private mode / denied site data). */
function makeHostileStorage() {
  return {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {
      throw new Error('denied');
    },
  };
}

describe('overlayCustomSize', () => {
  describe('parseStoredDimension', () => {
    test('accepts an in-range numeric string', () => {
      assert.equal(parseStoredDimension('900', 360, 2560), 900);
    });
    test('rounds a fractional value', () => {
      assert.equal(parseStoredDimension('900.6', 360, 2560), 901);
    });
    test('rejects absent / blank / whitespace', () => {
      assert.equal(parseStoredDimension(null, 360, 2560), null);
      assert.equal(parseStoredDimension(undefined, 360, 2560), null);
      assert.equal(parseStoredDimension('', 360, 2560), null);
      assert.equal(parseStoredDimension('   ', 360, 2560), null);
    });
    test('rejects non-numeric garbage', () => {
      assert.equal(parseStoredDimension('wide', 360, 2560), null);
      assert.equal(parseStoredDimension('NaN', 360, 2560), null);
      assert.equal(parseStoredDimension('Infinity', 360, 2560), null);
    });
    test('rejects out-of-range values rather than clamping them', () => {
      // Clamping a corrupt value would silently adopt it; a stored size we do
      // not recognise must fall back to the default geometry.
      assert.equal(parseStoredDimension('10', 360, 2560), null);
      assert.equal(parseStoredDimension('99999', 360, 2560), null);
    });
  });

  describe('readCustomOverlaySize', () => {
    test('reads both dimensions', () => {
      const storage = makeStorage({
        [CUSTOM_WIDTH_STORAGE_KEY]: '900',
        [CUSTOM_HEIGHT_STORAGE_KEY]: '640',
      });
      assert.deepEqual(readCustomOverlaySize(storage), { width: 900, height: 640 });
    });
    test('width and height are independent', () => {
      const storage = makeStorage({ [CUSTOM_WIDTH_STORAGE_KEY]: '900' });
      assert.deepEqual(readCustomOverlaySize(storage), { width: 900, height: null });
    });
    test('empty storage yields the default geometry', () => {
      assert.deepEqual(readCustomOverlaySize(makeStorage()), { width: null, height: null });
    });
    test('a throwing storage yields the default geometry, not an exception', () => {
      assert.deepEqual(readCustomOverlaySize(makeHostileStorage()), {
        width: null,
        height: null,
      });
    });
    test('absent storage yields the default geometry', () => {
      assert.deepEqual(readCustomOverlaySize(null), { width: null, height: null });
      assert.deepEqual(readCustomOverlaySize(undefined), { width: null, height: null });
    });
    test('a corrupt entry does not poison the other dimension', () => {
      const storage = makeStorage({
        [CUSTOM_WIDTH_STORAGE_KEY]: 'garbage',
        [CUSTOM_HEIGHT_STORAGE_KEY]: '640',
      });
      assert.deepEqual(readCustomOverlaySize(storage), { width: null, height: 640 });
    });
  });

  describe('write / clear round-trip', () => {
    test('a written size reads back identically', () => {
      const storage = makeStorage();
      assert.equal(writeCustomOverlaySize(storage, { width: 900, height: 640 }), true);
      assert.deepEqual(readCustomOverlaySize(storage), { width: 900, height: 640 });
    });
    test('fractional values round on the way in', () => {
      const storage = makeStorage();
      writeCustomOverlaySize(storage, { width: 900.4, height: 640.7 });
      assert.deepEqual(readCustomOverlaySize(storage), { width: 900, height: 641 });
    });
    test('clear restores auto-sizing', () => {
      const storage = makeStorage();
      writeCustomOverlaySize(storage, { width: 900, height: 640 });
      assert.equal(clearCustomOverlaySize(storage), true);
      assert.deepEqual(readCustomOverlaySize(storage), { width: null, height: null });
    });
    test('a null dimension means "not pinned" and removes that key', () => {
      // Widening with the east handle must not silently freeze the height too.
      const storage = makeStorage();
      writeCustomOverlaySize(storage, { width: 900, height: 640 });
      writeCustomOverlaySize(storage, { width: 1000, height: null });
      assert.deepEqual(readCustomOverlaySize(storage), { width: 1000, height: null });
    });
    test('a refused write is reported, not swallowed', () => {
      assert.equal(
        writeCustomOverlaySize(makeHostileStorage(), { width: 900, height: 640 }),
        false,
      );
      assert.equal(clearCustomOverlaySize(makeHostileStorage()), false);
    });
  });

  describe('maxWindowWidthFor / maxWindowHeightFor', () => {
    test('mirrors the main-process floor(workArea * 0.9) clamp', () => {
      // WindowHelper.setOverlayDimensionsAnchored clamps to this exact value;
      // if the renderer used a different bound it would persist a width the
      // window can never be given.
      assert.equal(maxWindowWidthFor(1920), 1728);
      assert.equal(maxWindowHeightFor(1080), 972);
    });
    test('falls back to the absolute ceiling when the display is unknown', () => {
      assert.equal(maxWindowWidthFor(0), OVERLAY_MAX_WINDOW_WIDTH);
      assert.equal(maxWindowWidthFor(NaN), OVERLAY_MAX_WINDOW_WIDTH);
    });
    test('never returns below the minimum on a tiny display', () => {
      assert.equal(maxWindowWidthFor(200), OVERLAY_MIN_WINDOW_WIDTH);
    });
  });

  describe('collapsedWidthFor', () => {
    test('the DEFAULT window width reproduces the historical 600 exactly', () => {
      // This is the regression guard for "resizing changed the default look".
      assert.equal(
        collapsedWidthFor(OVERLAY_DEFAULT_WINDOW_WIDTH),
        OVERLAY_DEFAULT_COLLAPSED_WIDTH,
      );
    });
    test('scales proportionally so the side margin keeps its ratio', () => {
      assert.equal(collapsedWidthFor(1200), 984);
    });
    test('converges on the window width for a very narrow overlay', () => {
      // Below the minimum window width the collapsed/expanded distinction is
      // meaningless — a tiny overlay should have no dead side margin at all.
      assert.equal(collapsedWidthFor(366), OVERLAY_MIN_WINDOW_WIDTH);
      assert.equal(collapsedWidthFor(OVERLAY_MIN_WINDOW_WIDTH), OVERLAY_MIN_WINDOW_WIDTH);
    });
    test('never exceeds the window it sits in', () => {
      for (const w of [360, 500, 732, 1200, 2560]) {
        assert.ok(collapsedWidthFor(w) <= w, `collapsed ${collapsedWidthFor(w)} > window ${w}`);
      }
    });
  });

  describe('pinsHeightFor', () => {
    test('height-driving directions pin the height', () => {
      assert.equal(pinsHeightFor('s', false), true);
      assert.equal(pinsHeightFor('se', false), true);
    });
    test('an east-only drag does NOT pin the height', () => {
      // Regression guard: computeResizeFrame clamps the pass-through height to
      // the display budget, so an 'e' drag on an overlay that is already taller
      // than the budget yields a CHANGED height. Treating that as a pin would
      // freeze the height as a side effect of merely widening the window.
      assert.equal(pinsHeightFor('e', false), false);
      const frame = computeResizeFrame({
        direction: 'e',
        dx: 50,
        dy: 0,
        startWidth: 732,
        startHeight: 2000,
        maxHeight: maxWindowHeightFor(1080),
      });
      assert.equal(frame.height, 972, 'height is clamped even on an east drag');
      assert.notEqual(frame.height, 2000);
    });
    test('an already-pinned height stays pinned through a width-only drag', () => {
      assert.equal(pinsHeightFor('e', true), true);
    });
  });

  describe('minWindowHeightFor', () => {
    test('derives the floor from measured chrome, not a constant', () => {
      // The shell is overflow-hidden: dragging shorter than
      // chrome + a usable scroll viewport clips the footer.
      assert.equal(minWindowHeightFor(180), 300);
      assert.equal(minWindowHeightFor(240, 150), 390);
    });
    test('never returns below the window minimum for tiny chrome', () => {
      assert.equal(minWindowHeightFor(0), OVERLAY_MIN_WINDOW_HEIGHT);
      assert.equal(minWindowHeightFor(50), OVERLAY_MIN_WINDOW_HEIGHT);
    });
    test('unmeasured chrome falls back to the window minimum', () => {
      assert.equal(minWindowHeightFor(NaN), OVERLAY_MIN_WINDOW_HEIGHT);
      assert.equal(minWindowHeightFor(-1), OVERLAY_MIN_WINDOW_HEIGHT);
    });
  });

  describe('computeResizeFrame', () => {
    const start = { startWidth: 732, startHeight: 500 };

    test('east drags width only', () => {
      assert.deepEqual(
        computeResizeFrame({ direction: 'e', dx: 100, dy: 80, ...start }),
        { width: 832, height: 500 },
      );
    });
    test('south drags height only', () => {
      assert.deepEqual(
        computeResizeFrame({ direction: 's', dx: 100, dy: 80, ...start }),
        { width: 732, height: 580 },
      );
    });
    test('south-east drags both', () => {
      assert.deepEqual(
        computeResizeFrame({ direction: 'se', dx: 100, dy: 80, ...start }),
        { width: 832, height: 580 },
      );
    });
    test('a negative delta shrinks', () => {
      assert.deepEqual(
        computeResizeFrame({ direction: 'se', dx: -100, dy: -80, ...start }),
        { width: 632, height: 420 },
      );
    });
    test('clamps to the floors', () => {
      const frame = computeResizeFrame({ direction: 'se', dx: -9999, dy: -9999, ...start });
      assert.equal(frame.width, OVERLAY_MIN_WINDOW_WIDTH);
      assert.equal(frame.height, OVERLAY_MIN_WINDOW_HEIGHT);
    });
    test('clamps to the caller-supplied display ceiling', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 9999,
        dy: 9999,
        ...start,
        maxWidth: maxWindowWidthFor(1920),
        maxHeight: maxWindowHeightFor(1080),
      });
      // Not availWidth - 40: the renderer must stop where the MAIN PROCESS
      // clamps, or the persisted width drifts from the applied one forever.
      assert.equal(frame.width, 1728);
      assert.equal(frame.height, 972);
    });
    test('honours a caller-supplied measured floor above the constant', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 0,
        dy: -9999,
        startWidth: 732,
        startHeight: 600,
        minHeight: minWindowHeightFor(180),
      });
      assert.equal(frame.height, 300, 'cannot be dragged shorter than chrome + scroll');
    });
    // SUPERSEDED (controlled-resize floors): this used to assert that a
    // measured floor below OVERLAY_MIN_WINDOW_HEIGHT was raised back to 216.
    // That premise is false — the overlay's own default state measures 154, so
    // clamping the floor up to 216 forbade returning to the very size the
    // product rule names as the minimum, and made the first downward drag on an
    // empty overlay jump it 62px TALLER. A measurement is better information
    // than the constant, so a positive measured floor now wins outright.
    // What the guard was really worth keeping is preserved below: garbage does
    // not get to unbound the window.
    test('a measured floor below the constant is honoured — 154 is a real state', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 0,
        dy: -9999,
        startWidth: 732,
        startHeight: 600,
        minHeight: 154,
      });
      assert.equal(frame.height, 154);
    });
    test('an unusable measured floor falls back to the constant', () => {
      for (const minHeight of [0, -50, NaN, undefined]) {
        const frame = computeResizeFrame({
          direction: 'se',
          dx: 0,
          dy: -9999,
          startWidth: 732,
          startHeight: 600,
          minHeight,
        });
        assert.equal(
          frame.height,
          OVERLAY_MIN_WINDOW_HEIGHT,
          `minHeight ${String(minHeight)} should fall back, not unbound the window`,
        );
      }
    });
    test('a ceiling below the floor still yields the floor (tiny display)', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 9999,
        dy: 9999,
        ...start,
        maxWidth: 100,
        maxHeight: 100,
      });
      assert.equal(frame.width, OVERLAY_MIN_WINDOW_WIDTH);
      assert.equal(frame.height, OVERLAY_MIN_WINDOW_HEIGHT);
    });
    test('output is always integral', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 10.4,
        dy: 10.6,
        startWidth: 732.3,
        startHeight: 500.2,
      });
      assert.equal(frame.width, Math.round(frame.width));
      assert.equal(frame.height, Math.round(frame.height));
    });
  });
});

/**
 * Controlled-resize floors.
 *
 * The product rule: the overlay may be dragged BIGGER than the size it would
 * auto-size itself to, never smaller. Two states, one rule —
 *
 *   meeting just started, nothing asked  → window 732 × 154 (panel 600)
 *   questions/answers present            → window 732 × whatever it auto-grew to
 *
 * Both width floors the user stated are PANEL widths (600 collapsed, 732
 * expanded). The panel is derived from the window by collapsedWidthFor, so
 * panel ≥ 600 and panel ≥ 732 both resolve to the SAME window floor of 732 —
 * which is the only dimension the resize handles actually change.
 *
 * The numbers below (732 / 600 / 154 / 830) are the values measured on the
 * reporting display; the helpers take them as arguments rather than baking
 * them in, so a different display or a wrapped input row cannot desynchronise
 * the floor from the layout it is supposed to describe.
 */
describe('overlayCustomSize — controlled resize floors', () => {
  describe('minWindowWidthFor', () => {
    test('the floor is the default window width on any ordinary display', () => {
      assert.equal(minWindowWidthFor(1470), OVERLAY_DEFAULT_WINDOW_WIDTH);
      assert.equal(minWindowWidthFor(1920), OVERLAY_DEFAULT_WINDOW_WIDTH);
      assert.equal(minWindowWidthFor(3840), OVERLAY_DEFAULT_WINDOW_WIDTH);
    });
    test('a collapsed panel at the floor is never narrower than 600', () => {
      // The user-facing half of the rule: window ≥ 732 ⟺ collapsed panel ≥ 600.
      assert.equal(collapsedWidthFor(minWindowWidthFor(1470)), OVERLAY_DEFAULT_COLLAPSED_WIDTH);
    });
    test('a display too small for the default cannot produce a floor above its own ceiling', () => {
      // Inverted bounds would make clamp() return the FLOOR for every drag,
      // pinning the overlay wider than the window the OS will grant.
      const availWidth = 700;
      const floor = minWindowWidthFor(availWidth);
      const ceiling = maxWindowWidthFor(availWidth);
      assert.ok(floor <= ceiling, `floor ${floor} exceeded ceiling ${ceiling}`);
      assert.equal(floor, ceiling);
    });
    test('an unknown display width falls back to the default, not to zero', () => {
      assert.equal(minWindowWidthFor(0), OVERLAY_DEFAULT_WINDOW_WIDTH);
      assert.equal(minWindowWidthFor(NaN), OVERLAY_DEFAULT_WINDOW_WIDTH);
      assert.equal(minWindowWidthFor(undefined), OVERLAY_DEFAULT_WINDOW_WIDTH);
    });
  });

  describe('naturalWindowHeightFor', () => {
    test('an empty overlay floors at its chrome height — the default state', () => {
      // No messages ⇒ no scrollable content ⇒ the window IS the chrome. 154 is
      // the measured default state; the old minWindowHeightFor(154) returned
      // 274, which is why dragging an empty overlay downward jumped it taller.
      assert.equal(naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 0 }), 154);
      assert.ok(naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 0 }) < minWindowHeightFor(154));
    });
    test('with content the floor is chrome + the full scroll extent', () => {
      assert.equal(naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 144 }), 298);
      assert.equal(naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 560 }), 714);
    });
    test('the floor never exceeds the display budget', () => {
      // A long conversation must not floor the overlay above the tallest
      // window the main process will grant.
      const maxHeight = maxWindowHeightFor(923);
      assert.equal(maxHeight, 830);
      assert.equal(
        naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 4000, maxHeight }),
        830,
      );
    });
    test('unmeasurable chrome falls back rather than flooring at zero', () => {
      assert.equal(
        naturalWindowHeightFor({ chromeHeight: NaN, scrollHeight: 0 }),
        OVERLAY_MIN_WINDOW_HEIGHT,
      );
      assert.equal(
        naturalWindowHeightFor({ chromeHeight: -5, scrollHeight: 0 }),
        OVERLAY_MIN_WINDOW_HEIGHT,
      );
    });
    test('output is integral', () => {
      const h = naturalWindowHeightFor({ chromeHeight: 153.4, scrollHeight: 144.3 });
      assert.equal(h, Math.round(h));
    });
  });

  describe('computeResizeFrame honours a caller-supplied width floor', () => {
    const start = { startWidth: 900, startHeight: 600 };
    test('a shrinking drag stops at the width floor, not at the 360 constant', () => {
      const frame = computeResizeFrame({
        direction: 'e',
        dx: -9999,
        dy: 0,
        ...start,
        minWidth: minWindowWidthFor(1470),
      });
      assert.equal(frame.width, OVERLAY_DEFAULT_WINDOW_WIDTH);
    });
    test('empty state: the drag cannot go below 732 × 154', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: -9999,
        dy: -9999,
        startWidth: 732,
        startHeight: 154,
        minWidth: minWindowWidthFor(1470),
        minHeight: naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 0 }),
      });
      assert.deepEqual(frame, { width: 732, height: 154 });
    });
    test('with content: the drag cannot go below the auto-grown height', () => {
      const minHeight = naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 560 });
      const frame = computeResizeFrame({
        direction: 'se',
        dx: -9999,
        dy: -9999,
        startWidth: 900,
        startHeight: 714,
        minWidth: minWindowWidthFor(1470),
        minHeight,
      });
      assert.deepEqual(frame, { width: 732, height: 714 });
    });
    test('growing past the floor is untouched — the floor only bounds shrinking', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 200,
        dy: 100,
        startWidth: 732,
        startHeight: 154,
        minWidth: minWindowWidthFor(1470),
        minHeight: naturalWindowHeightFor({ chromeHeight: 154, scrollHeight: 0 }),
        maxWidth: maxWindowWidthFor(1470),
        maxHeight: maxWindowHeightFor(923),
      });
      assert.deepEqual(frame, { width: 932, height: 254 });
    });
    test('a floor above the ceiling still yields the ceiling, never an inverted range', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 9999,
        dy: 9999,
        ...start,
        minWidth: 2000,
        minHeight: 2000,
        maxWidth: 800,
        maxHeight: 800,
      });
      assert.ok(frame.width >= 800 && Number.isFinite(frame.width));
      assert.ok(frame.height >= 800 && Number.isFinite(frame.height));
    });
    test('a floor taller than the drag start is a jump, not a floor', () => {
      // Pin the height to 298 with one exchange on screen, then let the
      // conversation run: the pin is deliberately NOT lifted (the chat scrolls
      // inside the chosen size), so the natural floor climbs to the 830 cap
      // while the window is still 298. Without the startHeight bound the first
      // move past the drag threshold snaps it 532px taller.
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 0,
        dy: -9999,
        startWidth: 900,
        startHeight: 298,
        minHeight: 830,
      });
      assert.equal(frame.height, 298, 'the drag must hold, not leap to the natural floor');
    });
    test('the jump guard also covers a width-only drag, which persists the height', () => {
      // 'e' never drives the height, but the height passes THROUGH the clamp —
      // and pinsHeightFor('e', alreadyPinned) is true, so a snap here would be
      // written to storage as the user's chosen height.
      const frame = computeResizeFrame({
        direction: 'e',
        dx: 40,
        dy: 0,
        startWidth: 900,
        startHeight: 298,
        minHeight: 830,
      });
      assert.equal(frame.height, 298);
      assert.equal(frame.width, 940);
    });
    test('the guard does not stop a drag from growing past the floor', () => {
      const frame = computeResizeFrame({
        direction: 's',
        dx: 0,
        dy: 300,
        startWidth: 732,
        startHeight: 298,
        minHeight: 830,
        maxHeight: maxWindowHeightFor(923),
      });
      assert.equal(frame.height, 598);
    });
    test('omitting minWidth keeps the historical constant, so existing callers are unaffected', () => {
      const frame = computeResizeFrame({ direction: 'e', dx: -9999, dy: 0, ...start });
      assert.equal(frame.width, OVERLAY_MIN_WINDOW_WIDTH);
    });
  });

  describe('clampCustomOverlaySize', () => {
    const bounds = { minWidth: 732, minHeight: 154, maxWidth: 1323, maxHeight: 830 };
    test('a size persisted under the old 360 floor is lifted, not honoured', () => {
      assert.deepEqual(
        clampCustomOverlaySize({ width: 400, height: 300 }, bounds),
        { width: 732, height: 300 },
      );
    });
    test('a size persisted on a larger display is brought within this one', () => {
      assert.deepEqual(
        clampCustomOverlaySize({ width: 2400, height: 1400 }, bounds),
        { width: 1323, height: 830 },
      );
    });
    test('an unpinned axis stays unpinned — null is not a zero to clamp', () => {
      assert.deepEqual(
        clampCustomOverlaySize({ width: null, height: 900 }, bounds),
        { width: null, height: 830 },
      );
      assert.deepEqual(
        clampCustomOverlaySize({ width: null, height: null }, bounds),
        { width: null, height: null },
      );
    });
    test('a missing floor does not drop the ceiling with it', () => {
      // The restore path supplies a width floor but NO height floor: nothing is
      // laid out at mount, so the natural height cannot be measured yet. The
      // height ceiling is known all the same and must still apply.
      assert.deepEqual(
        clampCustomOverlaySize(
          { width: 400, height: 1400 },
          { minWidth: 732, maxWidth: 1323, maxHeight: 830 },
        ),
        { width: 732, height: 830 },
      );
    });
    test('an inverted pair yields the floor, matching computeResizeFrame', () => {
      assert.deepEqual(
        clampCustomOverlaySize({ width: 500, height: 500 }, {
          minWidth: 900,
          maxWidth: 800,
          minHeight: 900,
          maxHeight: 800,
        }),
        { width: 900, height: 900 },
      );
    });
    test('a size already within the floors is returned unchanged', () => {
      assert.deepEqual(
        clampCustomOverlaySize({ width: 900, height: 500 }, bounds),
        { width: 900, height: 500 },
      );
    });
  });
});

/**
 * Smooth free-form resize: the whole drag is rendered in CSS inside a
 * pre-grown transparent window — ONE native resize on grab, ONE on release,
 * none in between. These are the pure pieces of that choreography.
 */
describe('overlayCustomSize — smooth resize envelope', () => {
  const workArea = { x: 0, y: 33, width: 1470, height: 923 };

  describe('resizeEnvelopeFor', () => {
    test('grows right and down as far as the budget allows without moving the origin', () => {
      // Overlay centred on the display: 0.9·1470 = 1323 would overflow the
      // right edge from x=369 (369+1323 > 1470) and the main-process clamp
      // would then SHIFT X — the one-frame flash this exists to avoid. The
      // envelope stops at the edge instead.
      const env = resizeEnvelopeFor({ x: 369, y: 117, width: 732, height: 154, workArea });
      assert.deepEqual(env, { width: 1470 - 369, height: 830 });
      assert.ok(env.width <= workArea.width * 0.9);
      assert.ok(env.height <= Math.floor(workArea.height * 0.9));
    });
    test('respects the budget when the origin leaves more room than the budget allows', () => {
      const env = resizeEnvelopeFor({ x: 0, y: 33, width: 732, height: 154, workArea });
      assert.deepEqual(env, { width: 1323, height: 830 });
    });
    test('is never smaller than the window already is', () => {
      // Flush against the right edge: no room to grow, but shrinking on grab
      // would clip the panel the user is about to drag.
      const env = resizeEnvelopeFor({ x: 1470 - 900, y: 117, width: 900, height: 700, workArea });
      assert.deepEqual(env, { width: 900, height: 830 });
      const tall = resizeEnvelopeFor({ x: 0, y: 900, width: 732, height: 200, workArea });
      assert.equal(tall.height, 200);
    });
    test('output is integral', () => {
      const env = resizeEnvelopeFor({ x: 10.4, y: 33, width: 732, height: 154, workArea });
      assert.equal(env.width, Math.round(env.width));
      assert.equal(env.height, Math.round(env.height));
    });
  });

  describe('panelWidthFloorFor', () => {
    test('empty state floors the PANEL at its collapsed default', () => {
      assert.equal(panelWidthFloorFor({ hasContent: false, startWidth: 600 }), 600);
      assert.equal(panelWidthFloorFor({ hasContent: false, startWidth: 900 }), 600);
    });
    test('with content the panel floors at its expanded default', () => {
      assert.equal(panelWidthFloorFor({ hasContent: true, startWidth: 900 }), 732);
    });
    test('never above where the drag starts — a taller floor would be a jump', () => {
      // Text-only content leaves the panel collapsed at 600; a 732 floor
      // would leap it 132px on the first move.
      assert.equal(panelWidthFloorFor({ hasContent: true, startWidth: 600 }), 600);
    });
  });

  describe('releaseWindowWidthFor', () => {
    test('a panel narrower than the default window centres inside the default', () => {
      assert.equal(releaseWindowWidthFor(650, 1470), OVERLAY_DEFAULT_WINDOW_WIDTH);
    });
    test('a panel at or past the default fills the window', () => {
      assert.equal(releaseWindowWidthFor(732, 1470), 732);
      assert.equal(releaseWindowWidthFor(1044, 1470), 1044);
    });
    test('clamps to the display ceiling', () => {
      assert.equal(releaseWindowWidthFor(5000, 1470), maxWindowWidthFor(1470));
    });
  });
});

/**
 * The MANUAL height floor. Auto expand/contract is the primary sizing and is
 * untouched by any of this: it reports the content height whenever no height
 * is pinned, and only a manual drag pins one. This floor bounds that drag.
 */
describe('overlayCustomSize — manualHeightFloorFor', () => {
  test('with responses the floor is 450, not the auto-grown height', () => {
    // A long chat auto-grows to the 830 cap; the old floor sat there too, so
    // the overlay could not be shrunk at all mid-conversation.
    assert.equal(OVERLAY_CONTENT_MIN_WINDOW_HEIGHT, 450);
    assert.equal(
      manualHeightFloorFor({ hasContent: true, chromeHeight: 154, maxHeight: 830 }),
      450,
    );
  });
  test('empty state floors at the chrome — the default state — as before', () => {
    assert.equal(manualHeightFloorFor({ hasContent: false, chromeHeight: 154, maxHeight: 830 }), 154);
  });
  test('the floor can never be shorter than the chrome, or the footer clips', () => {
    assert.equal(
      manualHeightFloorFor({ hasContent: true, chromeHeight: 480, maxHeight: 830 }),
      480,
    );
  });
  test('the floor never exceeds the display budget', () => {
    assert.equal(manualHeightFloorFor({ hasContent: true, chromeHeight: 154, maxHeight: 400 }), 400);
  });
  test('unmeasurable chrome falls back to the constant floor rather than zero', () => {
    assert.equal(
      manualHeightFloorFor({ hasContent: false, chromeHeight: NaN, maxHeight: 830 }),
      OVERLAY_MIN_WINDOW_HEIGHT,
    );
  });
  test('a short chat still cannot be dragged below where it is (jump guard)', () => {
    const frame = computeResizeFrame({
      direction: 's',
      dx: 0,
      dy: -9999,
      startWidth: 732,
      startHeight: 298,
      minHeight: manualHeightFloorFor({ hasContent: true, chromeHeight: 154, maxHeight: 830 }),
    });
    assert.equal(frame.height, 298);
  });
  test('a long chat shrinks to exactly 450', () => {
    const frame = computeResizeFrame({
      direction: 's',
      dx: 0,
      dy: -9999,
      startWidth: 732,
      startHeight: 810,
      minHeight: manualHeightFloorFor({ hasContent: true, chromeHeight: 154, maxHeight: 830 }),
    });
    assert.equal(frame.height, 450);
  });
});
