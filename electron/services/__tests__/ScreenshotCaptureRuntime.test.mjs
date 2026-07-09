// electron/services/__tests__/ScreenshotCaptureRuntime.test.mjs
//
// RUNTIME (not source-level) coverage for the Cmd+Shift+H "Selective Screenshot"
// full-screen bug fixes. Complements ScreenshotCropDensity.test.mjs, which pins the
// pure computeThumbnailCrop() helper. Here we drive the REAL single-display capture
// path (captureWithDesktopCapturer via the public takeSelectiveScreenshot) with a
// mocked Electron surface, and assert the end-to-end behaviour of the two CRITICAL
// fixes:
//
//   Fix #1 (density-agnostic crop): a right/bottom-edge selection on a 1× thumbnail
//     produces a PNG whose pixel dimensions equal the (density-correct) selection —
//     NOT the full screen.
//   Fix #2 (fail loud): a selection that maps to an empty crop THROWS a distinct
//     "Region capture failed: ..." error, writes NO file, and does NOT reuse the
//     "Selection cancelled" wording (so the IPC layer treats it as a real failure).
//
// The prior engineer skipped this as "disproportionate scaffolding". It turns out a
// lightweight mock is feasible: under ELECTRON_RUN_AS_NODE, require("electron") returns
// a frozen string (the binary path), so we cannot monkeypatch the module object. We
// instead install a Module._load hook that returns a fake `electron` object BEFORE the
// compiled ScreenshotHelper.js is imported. The fake supplies desktopCapturer, screen,
// app, systemPreferences and a nativeImage-shaped thumbnail with getSize()/crop()/toPNG().
//
// Run: `ELECTRON_RUN_AS_NODE=1 electron --test`
//   (also runs under bare `node --test` — no native ABI is touched.)

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../../dist-electron/electron/ScreenshotHelper.js');

// ---- Minimal nativeImage-shaped thumbnail stub ---------------------------------
// Records every crop() call and produces a deterministic "PNG" whose byte length
// encodes the pixel dimensions, so the test can read back exactly what was written
// without decoding a real PNG.
function makeThumbnail(width, height) {
  const img = {
    _w: width,
    _h: height,
    cropCalls: [],
    getSize() {
      return { width: this._w, height: this._h };
    },
    crop(rect) {
      this.cropCalls.push({ ...rect });
      // Electron's nativeImage.crop returns a NEW image of the crop size.
      return makeThumbnail(rect.width, rect.height);
    },
    toPNG() {
      // Encode dimensions into the buffer so writes are verifiable.
      // Not a real PNG — the test never decodes it, only measures/parses it.
      return Buffer.from(JSON.stringify({ w: this._w, h: this._h }), 'utf8');
    }
  };
  return img;
}

const BOUNDS = { x: 0, y: 0, width: 1440, height: 900 };
const DISPLAY = { id: 1, scaleFactor: 2, bounds: BOUNDS };

// Mutable capture-control state the fake desktopCapturer reads.
let currentThumbnail;
let getSourcesCalls;
let writtenFiles; // { path, buffer } records for every fs.writeFile the SUT performs

function makeFakeElectron() {
  return {
    app: {
      isPackaged: false, // => assertScreenRecordingPermission() is a no-op
      getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-runtime-'))
    },
    screen: {
      getAllDisplays: () => [DISPLAY],
      getPrimaryDisplay: () => DISPLAY
    },
    desktopCapturer: {
      getSources: async () => {
        getSourcesCalls++;
        return [
          {
            id: 'screen:0:0',
            name: 'Entire Screen',
            display_id: String(DISPLAY.id),
            thumbnail: currentThumbnail
          }
        ];
      }
    },
    systemPreferences: {
      getMediaAccessStatus: () => 'granted'
    },
    nativeImage: {}
  };
}

let ScreenshotHelper;
let originalLoad;

before(async () => {
  // Install the require("electron") interception BEFORE importing the compiled SUT.
  originalLoad = Module._load;
  const fakeElectron = makeFakeElectron();
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.apply(this, arguments);
  };

  const mod = await import(path.sep === '\\'
    ? 'file://' + COMPILED.replace(/\\/g, '/')
    : 'file://' + COMPILED);
  ScreenshotHelper = mod.ScreenshotHelper;
  assert.equal(typeof ScreenshotHelper, 'function', 'compiled ScreenshotHelper class must be importable');
});

after(() => {
  if (originalLoad) Module._load = originalLoad;
});

beforeEach(() => {
  getSourcesCalls = 0;
  writtenFiles = [];
});

// Wrap fs.promises.writeFile so we observe exactly what the SUT writes to disk.
// We DO write real bytes (to the SUT's own temp userData dir) because
// takeSelectiveScreenshot() verifies the file exists post-write (fs.existsSync)
// and throws "Selection cancelled" if it's missing. We track and clean them up.
function interceptWrites() {
  const origWrite = fs.promises.writeFile;
  fs.promises.writeFile = async (p, data) => {
    const buffer = Buffer.from(data);
    writtenFiles.push({ path: String(p), buffer });
    return origWrite.call(fs.promises, p, buffer); // real write so existsSync passes
  };
  return () => {
    fs.promises.writeFile = origWrite;
    for (const { path: p } of writtenFiles) {
      try { fs.unlinkSync(p); } catch { /* best-effort */ }
    }
  };
}

function decodeWritten(buf) {
  return JSON.parse(buf.toString('utf8')); // { w, h }
}

describe('captureWithDesktopCapturer runtime (single display, mocked Electron)', () => {
  test('Fix #1: 1× thumbnail + bottom-right selection writes a density-correct crop, NOT the full screen', async () => {
    // Electron hands back a LOGICAL (1×) thumbnail — the exact case the old
    // `* scaleFactor` math turned into a full-screen write.
    currentThumbnail = makeThumbnail(BOUNDS.width, BOUNDS.height); // 1440×900 == 1×
    const restore = interceptWrites();
    try {
      const helper = new ScreenshotHelper('queue');
      const area = { x: 1400, y: 860, width: 40, height: 40 }; // hugs bottom-right corner
      const outPath = await helper.takeSelectiveScreenshot(area);

      assert.ok(outPath, 'should return a screenshot path');
      assert.equal(writtenFiles.length, 1, 'exactly one file must be written');

      const dims = decodeWritten(writtenFiles[0].buffer);
      // At 1× the crop equals the logical selection — 40×40, NOT 1440×900.
      assert.deepEqual(dims, { w: 40, h: 40 }, 'written image must be the 40×40 crop, not the full screen');

      // Hard guard against the exact regression symptom: never the full thumbnail size.
      assert.ok(
        !(dims.w === BOUNDS.width && dims.h === BOUNDS.height),
        'must NOT have written a full-screen (1440×900) image'
      );

      // The thumbnail was actually cropped (crop() was invoked with the density-correct rect).
      assert.equal(currentThumbnail.cropCalls.length, 1, 'crop() must be called exactly once');
      assert.deepEqual(currentThumbnail.cropCalls[0], { x: 1400, y: 860, width: 40, height: 40 });
    } finally {
      restore();
    }
  });

  test('Fix #1: native-2× thumbnail maps the SAME selection to a 2×-pixel crop', async () => {
    currentThumbnail = makeThumbnail(BOUNDS.width * 2, BOUNDS.height * 2); // 2880×1800 == 2×
    const restore = interceptWrites();
    try {
      const helper = new ScreenshotHelper('queue');
      const area = { x: 1400, y: 860, width: 40, height: 40 };
      await helper.takeSelectiveScreenshot(area);

      assert.equal(writtenFiles.length, 1);
      const dims = decodeWritten(writtenFiles[0].buffer);
      // 2× thumbnail => the same logical selection is 80×80 native pixels.
      assert.deepEqual(dims, { w: 80, h: 80 }, 'native-2× crop must be 80×80');
      assert.deepEqual(currentThumbnail.cropCalls[0], { x: 2800, y: 1720, width: 80, height: 80 });
    } finally {
      restore();
    }
  });

  test('Fix #2: empty crop THROWS "Region capture failed", writes NO file, never crops', async () => {
    currentThumbnail = makeThumbnail(BOUNDS.width, BOUNDS.height); // 1×
    const restore = interceptWrites();
    try {
      const helper = new ScreenshotHelper('queue');
      // Selection origin sits entirely off the right edge of the display → empty crop.
      const area = { x: 2000, y: 100, width: 50, height: 50 };

      await assert.rejects(
        () => helper.takeSelectiveScreenshot(area),
        (err) => {
          assert.match(err.message, /Region capture failed/, 'must be a region-capture failure');
          return true;
        },
        'must reject on an empty crop'
      );

      // The CRITICAL invariant: nothing was written to disk.
      assert.equal(writtenFiles.length, 0, 'no file may be written on a failed crop');
      // And the thumbnail was never cropped (we threw before crop()).
      assert.equal(currentThumbnail.cropCalls.length, 0, 'crop() must not be called for an empty crop');
    } finally {
      restore();
    }
  });

  test('Fix #2: the thrown failure is DISTINCT from "Selection cancelled"', async () => {
    currentThumbnail = makeThumbnail(BOUNDS.width, BOUNDS.height);
    const restore = interceptWrites();
    try {
      const helper = new ScreenshotHelper('queue');
      const area = { x: 100, y: 1200, width: 50, height: 50 }; // off the bottom → empty crop

      let caught;
      try {
        await helper.takeSelectiveScreenshot(area);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, 'must throw');
      // The whole point of fix #2: the IPC layer (ipcHandlers.ts) only maps the exact
      // string "Selection cancelled" to {cancelled:true}. A real failure must NOT match,
      // or a genuine bug would be silently swallowed as a user cancel.
      assert.notEqual(caught.message, 'Selection cancelled');
      assert.doesNotMatch(caught.message, /Selection cancelled/);
      assert.equal(writtenFiles.length, 0);
    } finally {
      restore();
    }
  });

  test('sanity: a full-screen (no-area) capture DOES write the full thumbnail', async () => {
    // Guards against the fix over-correcting: with no selection, the full image is intended.
    currentThumbnail = makeThumbnail(BOUNDS.width, BOUNDS.height);
    const restore = interceptWrites();
    try {
      const helper = new ScreenshotHelper('queue');
      const outPath = await helper.takeScreenshot(); // no area
      assert.ok(outPath);
      assert.equal(writtenFiles.length, 1);
      const dims = decodeWritten(writtenFiles[0].buffer);
      assert.deepEqual(dims, { w: BOUNDS.width, h: BOUNDS.height }, 'full capture writes the whole thumbnail');
      assert.equal(currentThumbnail.cropCalls.length, 0, 'no crop when no area is given');
    } finally {
      restore();
    }
  });
});

// ---- Fix #3 anti-drift: the MULTI-display helper uses the SAME density-agnostic math,
// verified against two displays with DIFFERENT scale factors (1× external + 2× built-in).
// This proves each per-display intersection maps to its own thumbnail's pixel space and
// the two crop strategies cannot diverge. We test the pure helper directly (no stitching)
// because computeThumbnailCrop is the shared primitive both paths call.
describe('computeThumbnailCrop: mixed-DPI multi-display anti-drift', () => {
  let computeThumbnailCrop;
  before(async () => {
    const mod = await import('file://' + COMPILED);
    computeThumbnailCrop = mod.computeThumbnailCrop;
  });

  test('1× external (right) + 2× built-in (left): each intersection maps to its own pixel space', () => {
    // Built-in Retina at origin: 1440×900 logical, 2× thumbnail (2880×1800).
    const builtIn = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, thumb: { width: 2880, height: 1800 } };
    // External 1× monitor to the right: 1920×1080 logical, 1× thumbnail (1920×1080).
    const external = { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, thumb: { width: 1920, height: 1080 } };

    // A selection straddling the seam at x=1440.
    // Portion on the built-in (2×): x 1340..1440 → intersection {x:1340,w:100}.
    const leftIntersection = { x: 1340, y: 200, width: 100, height: 100 };
    const leftCrop = computeThumbnailCrop(builtIn.thumb, builtIn.bounds, leftIntersection);
    // 2× ratio → coordinates and size double.
    assert.deepEqual(leftCrop, { x: 2680, y: 400, width: 200, height: 200 }, 'built-in maps at 2×');
    assert.ok(leftCrop.x + leftCrop.width <= builtIn.thumb.width);

    // Portion on the external (1×): intersection {x:1440,w:100} in absolute coords.
    const rightIntersection = { x: 1440, y: 200, width: 100, height: 100 };
    const rightCrop = computeThumbnailCrop(external.thumb, external.bounds, rightIntersection);
    // 1× ratio → coordinates are relative to the external's origin (1440) and unscaled.
    assert.deepEqual(rightCrop, { x: 0, y: 200, width: 100, height: 100 }, 'external maps at 1× relative to its origin');
    assert.ok(rightCrop.x + rightCrop.width <= external.thumb.width);

    // The anti-drift point: identical logical selection width (100) produced DIFFERENT
    // pixel widths (200 vs 100) purely from each display's own thumbnail density —
    // exactly what a single shared helper guarantees and a divergent copy would break.
    assert.notEqual(leftCrop.width, rightCrop.width);
  });
});
