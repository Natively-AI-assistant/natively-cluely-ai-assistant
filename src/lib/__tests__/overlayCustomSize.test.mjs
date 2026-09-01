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
    test('a measured floor below the constant never lowers the constant', () => {
      const frame = computeResizeFrame({
        direction: 'se',
        dx: 0,
        dy: -9999,
        startWidth: 732,
        startHeight: 600,
        minHeight: 50,
      });
      assert.equal(frame.height, OVERLAY_MIN_WINDOW_HEIGHT);
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
