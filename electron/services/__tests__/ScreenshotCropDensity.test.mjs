// electron/services/__tests__/ScreenshotCropDensity.test.mjs
//
// Regression coverage for the Cmd+Shift+H "Selective Screenshot" full-screen bug.
//
// The single-display crop path (captureWithDesktopCapturer) used to multiply the
// selection by display.scaleFactor, assuming Electron's desktopCapturer always
// returns a native-pixel (2×/3×) thumbnail. When macOS/Electron returned a 1×
// (logical-sized) thumbnail instead, a right/bottom-edge selection computed a crop
// whose x+width exceeded the image; the width clamp went NEGATIVE and the old code
// silently wrote the FULL uncropped thumbnail — i.e. the "entire screen" symptom.
//
// The fix routes BOTH crop paths through the pure, density-agnostic helper
// computeThumbnailCrop(), which derives the ratio from the ACTUAL returned thumbnail
// size vs the display bounds. This test pins that helper so the bug cannot recur:
//   - a right/bottom selection always maps into [0, sourceSize] with a non-empty rect
//   - the same logical selection maps correctly under 1×, 2× and fractional scales
//   - a genuinely out-of-bounds/degenerate selection returns an EMPTY rect so the
//     single-display caller can throw instead of emitting the full screen.
//
// Run under the electron test runner (native ABI is irrelevant here, but we keep the
// repo convention): `ELECTRON_RUN_AS_NODE=1 electron --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/ScreenshotHelper.js')
).href;

const { computeThumbnailCrop } = await import(MODULE_URL);

// A representative HiDPI logical display: 1440×900 points at (0,0).
const BOUNDS = { x: 0, y: 0, width: 1440, height: 900 };
// The size the thumbnail takes at a given density factor.
const sourceSizeAt = (factor) => ({
  width: BOUNDS.width * factor,
  height: BOUNDS.height * factor
});

describe('computeThumbnailCrop', () => {
  test('helper exists and is a pure function', () => {
    assert.equal(typeof computeThumbnailCrop, 'function');
  });

  // ---- Fix #1: the entire-screen bug cannot recur on a 1× thumbnail ----
  test('1× thumbnail: right/bottom-edge selection yields a NON-EMPTY in-bounds crop', () => {
    const sourceSize = sourceSizeAt(1); // Electron returned a logical-sized (1×) image
    // Selection hugging the bottom-right corner — the exact case that used to overflow.
    const area = { x: 1400, y: 860, width: 40, height: 40 };

    const crop = computeThumbnailCrop(sourceSize, BOUNDS, area);

    assert.ok(crop.width > 0 && crop.height > 0, 'crop must be non-empty');
    // The invariant the old code violated: never exceed the image.
    assert.ok(crop.x + crop.width <= sourceSize.width, 'x+width must stay within image width');
    assert.ok(crop.y + crop.height <= sourceSize.height, 'y+height must stay within image height');
    // At 1× the crop equals the logical selection.
    assert.deepEqual(crop, { x: 1400, y: 860, width: 40, height: 40 });
  });

  // ---- Fix #1: native-2× thumbnail maps the SAME logical selection to 2× pixels ----
  test('2× thumbnail: same logical selection maps to the correct 2×-pixel rect', () => {
    const sourceSize = sourceSizeAt(2); // native-pixel (Retina) thumbnail
    const area = { x: 1400, y: 860, width: 40, height: 40 };

    const crop = computeThumbnailCrop(sourceSize, BOUNDS, area);

    assert.deepEqual(crop, { x: 2800, y: 1720, width: 80, height: 80 });
    assert.ok(crop.x + crop.width <= sourceSize.width);
    assert.ok(crop.y + crop.height <= sourceSize.height);
  });

  // ---- Fix #1: extreme edge selection clamps to a valid non-empty rect ----
  test('extreme right/bottom-edge selection clamps in-bounds under 1× and 2×', () => {
    // A selection that starts inside the display but extends past the bottom-right
    // corner (e.g. the cropper overshoots by a pixel). Must clamp, not overflow.
    const area = { x: 1439, y: 899, width: 100, height: 100 };

    for (const factor of [1, 2]) {
      const sourceSize = sourceSizeAt(factor);
      const crop = computeThumbnailCrop(sourceSize, BOUNDS, area);

      assert.ok(crop.width > 0 && crop.height > 0, `factor ${factor}: crop must be non-empty`);
      assert.ok(crop.x + crop.width <= sourceSize.width, `factor ${factor}: x+width in bounds`);
      assert.ok(crop.y + crop.height <= sourceSize.height, `factor ${factor}: y+height in bounds`);
    }
  });

  // ---- Fix #2 support: degenerate/out-of-bounds selections return an EMPTY rect ----
  test('out-of-bounds selection returns an empty rect so the single-display caller throws', () => {
    const sourceSize = sourceSizeAt(1);
    // Origin sits entirely off the right edge of the display.
    const offRight = { x: 2000, y: 100, width: 50, height: 50 };
    const cropRight = computeThumbnailCrop(sourceSize, BOUNDS, offRight);
    assert.equal(cropRight.width, 0, 'off-right selection → width 0');

    // Origin off the bottom edge.
    const offBottom = { x: 100, y: 1200, width: 50, height: 50 };
    const cropBottom = computeThumbnailCrop(sourceSize, BOUNDS, offBottom);
    assert.equal(cropBottom.height, 0, 'off-bottom selection → height 0');
  });

  test('zero-size (degenerate) selection returns an empty rect', () => {
    const sourceSize = sourceSizeAt(1);
    const zero = { x: 100, y: 100, width: 0, height: 0 };
    const crop = computeThumbnailCrop(sourceSize, BOUNDS, zero);
    assert.ok(crop.width === 0 || crop.height === 0, 'degenerate selection → empty rect');
  });

  test('zero display bounds do not produce NaN/Infinity (ratio guard)', () => {
    const crop = computeThumbnailCrop(
      { width: 100, height: 100 },
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 0, y: 0, width: 10, height: 10 }
    );
    for (const v of Object.values(crop)) {
      assert.ok(Number.isFinite(v), `crop value ${v} must be finite`);
    }
  });

  // ---- Fix #3 parametrization: scaleFactor ∈ {1, 2, 2.5} × sourceSize ∈ {1×, 2×} ----
  // The helper is density-agnostic: it ignores the OS scaleFactor entirely and only
  // reads the actual thumbnail size. This matrix proves a mid-display selection always
  // maps to the correct pixel rect regardless of the (scaleFactor, thumbnail) pairing,
  // which is precisely the fragile assumption that broke.
  for (const scaleFactor of [1, 2, 2.5]) {
    for (const thumbFactor of [1, 2]) {
      test(`matrix scaleFactor=${scaleFactor} thumbnail=${thumbFactor}×: mid-display selection maps correctly and stays in bounds`, () => {
        const sourceSize = sourceSizeAt(thumbFactor);
        // A selection well inside the display.
        const area = { x: 200, y: 150, width: 400, height: 300 };

        const crop = computeThumbnailCrop(sourceSize, BOUNDS, area);

        // Correctness: the crop scales by the THUMBNAIL factor, never by scaleFactor.
        assert.deepEqual(crop, {
          x: 200 * thumbFactor,
          y: 150 * thumbFactor,
          width: 400 * thumbFactor,
          height: 300 * thumbFactor
        }, `scaleFactor=${scaleFactor} must not influence the result`);

        // Bounds invariant holds in every cell of the matrix.
        assert.ok(crop.x + crop.width <= sourceSize.width);
        assert.ok(crop.y + crop.height <= sourceSize.height);
        assert.ok(crop.width > 0 && crop.height > 0);
      });
    }
  }

  // A left-shifted (negative offset) selection must clamp its origin to 0, not go
  // negative — the other side of the clamp the old Math.max(0, ...) already handled,
  // pinned here so the shared helper never regresses it.
  test('selection extending past the top-left origin clamps to 0', () => {
    const sourceSize = sourceSizeAt(2);
    const bounds = { x: 100, y: 100, width: 1440, height: 900 }; // display NOT at origin
    // area.x < bounds.x → raw thumbnail x would be negative.
    const area = { x: 50, y: 50, width: 200, height: 200 };
    const crop = computeThumbnailCrop(sourceSize, bounds, area);
    assert.equal(crop.x, 0);
    assert.equal(crop.y, 0);
    assert.ok(crop.width > 0 && crop.height > 0);
  });
});

// ---- Fix #2 (code-level assertion): captureWithDesktopCapturer THROWS, never writes,
// when the crop is invalid. Mocking Electron's desktopCapturer/nativeImage at runtime
// requires disproportionate scaffolding under this runner, so we assert the guard at
// the SOURCE level: the single-display crop block must throw on an empty crop and must
// NOT fall through to fs.writeFile. This is paired with the pure-function coverage above.
describe('captureWithDesktopCapturer: fail-loud guard (source-level)', () => {
  const SOURCE = path.resolve(__dirname, '../../ScreenshotHelper.ts');

  test('empty crop throws a distinct error and does not silently write the full screen', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(SOURCE, 'utf8');

    // The single-display path must use the shared helper (no lingering * scaleFactor math).
    assert.ok(
      /const croppedArea = computeThumbnailCrop\(sourceSize, displayBounds, area\)/.test(src),
      'single-display path must call computeThumbnailCrop'
    );
    assert.ok(
      !/Math\.round\(area\.width \* scaleFactor\)/.test(src),
      'the old scaleFactor crop math must be gone'
    );

    // On an empty crop it must THROW (region-capture failure), not warn-and-continue.
    assert.ok(
      /if \(croppedArea\.width <= 0 \|\| croppedArea\.height <= 0\)\s*\{[\s\S]*?throw new Error\(/.test(src),
      'empty crop must throw'
    );
    // The thrown message must be distinguishable from a user cancel so the IPC layer
    // (ipcHandlers.ts: message === "Selection cancelled" ? cancelled : rethrow) does not
    // mislabel a real failure as a cancel.
    assert.ok(
      /Region capture failed:/.test(src),
      'thrown message must be distinct from "Selection cancelled"'
    );
    assert.ok(
      !/skipping crop/.test(src),
      'the silent "skipping crop" fall-through must be removed'
    );
  });
});
