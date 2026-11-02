// electron/utils/__tests__/OnnxModelSizeFloor2026_10_14.test.mjs
//
// The memory gate for local STT was one flat number (2 GB available) for every
// model. An 8 GB laptop with a call client and a browser open is often under
// that, so local STT refused to start even for the 26 MB Moonshine Tiny the app
// recommends for small machines.
//
// The floor now follows the model's size, and is never HIGHER than the shared
// floor — so no model is refused under conditions that admit it today.
//
// The floor is arithmetic and platform-independent. Only the MEASUREMENT
// differs per OS (vm_stat on macOS, os.freemem() on Windows); it is forced
// here through the documented env override, so both platforms take this path.
//
// Run: npm run build:electron && node --test electron/utils/__tests__/OnnxModelSizeFloor2026_10_14.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gate = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/utils/onnxThreadConfig.js')).href);
const { getMinFreeGBForModelSize, hasEnoughMemoryForModelSize, hasEnoughMemoryForOnnxSession, getMinFreeGBForOnnxSession, checkMemoryForModelSize, describeModelMemoryShortfall } = gate;

afterEach(() => {
  delete process.env.NATIVELY_ONNX_MIN_FREE_GB;
  delete process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
});

test('small models need far less than the shared floor', () => {
  assert.equal(getMinFreeGBForOnnxSession(), 2);
  assert.equal(getMinFreeGBForModelSize(26), 0.55);   // Moonshine Tiny
  assert.equal(getMinFreeGBForModelSize(60), 0.62);   // Moonshine Base
  assert.equal(getMinFreeGBForModelSize(164), 0.82);  // Distil Small EN
  assert.equal(getMinFreeGBForModelSize(466), 1.41);  // Whisper Small
  assert.equal(getMinFreeGBForModelSize(670), 1.81);  // Parakeet TDT v3
});

test('no model is ever asked for MORE than the shared floor', () => {
  for (const mb of [793, 1031, 1500, 1530, 50_000]) {
    assert.equal(getMinFreeGBForModelSize(mb), 2, `${mb} MB`);
  }
});

test('an unknown size falls back to the shared floor, not to zero', () => {
  for (const bad of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(getMinFreeGBForModelSize(bad), 2);
  }
});

test('RED STATE then FIX: 1.2 GB available refused every model; now it admits the small ones', () => {
  process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '1.2';
  assert.equal(hasEnoughMemoryForOnnxSession(), false, 'the flat gate refuses');
  assert.equal(hasEnoughMemoryForModelSize(26), true, 'Moonshine Tiny runs');
  assert.equal(hasEnoughMemoryForModelSize(60), true, 'Moonshine Base runs');
  assert.equal(hasEnoughMemoryForModelSize(466), false, 'Whisper Small still does not fit');
  assert.equal(hasEnoughMemoryForModelSize(1031), false, 'Large v3 Turbo still does not fit');
});

test('a machine that really is out of memory is still refused', () => {
  process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.3';
  assert.equal(hasEnoughMemoryForModelSize(26), false);
});

test('the operator override still sets the ceiling, including "off"', () => {
  process.env.NATIVELY_ONNX_MIN_FREE_GB = '0';
  assert.equal(getMinFreeGBForModelSize(1031), 0);
  assert.equal(getMinFreeGBForModelSize(26), 0);
  process.env.NATIVELY_ONNX_MIN_FREE_GB = '1';
  assert.equal(getMinFreeGBForModelSize(26), 0.55);
  assert.equal(getMinFreeGBForModelSize(1031), 1);
});

// Issue #707: a refusal must print the reading the gate refused on, and never a
// figure that looks like enough. The check hands back that reading, so the
// message cannot drift from it when the 1s measurement cache expires.
test('the check returns the reading it decided on and the floor it used', () => {
  process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.6151';
  assert.deepEqual(checkMemoryForModelSize(60), { ok: false, availableGB: 0.6151, source: 'override', floorGB: 0.62 });
  assert.equal(hasEnoughMemoryForModelSize(60), false);
  process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.62';
  assert.equal(checkMemoryForModelSize(60).ok, true, 'exactly the floor is enough');
});

test('a refused reading is rounded DOWN, so it never prints as enough', () => {
  // Plain toFixed(2) printed "0.62GB available, this model needs 0.62GB".
  assert.equal(
    describeModelMemoryShortfall({ ok: false, availableGB: 0.6151, floorGB: 0.62 }),
    '0.61GB available, this model needs 0.62GB',
  );
  // Shared floor: 1.996 GB used to print as "2.00GB available ... needs 2GB".
  assert.equal(
    describeModelMemoryShortfall({ ok: false, availableGB: 1.996, floorGB: 2 }),
    '1.99GB available, this model needs 2GB',
  );
  for (const mb of [26, 60, 164, 466, 670, 2850, undefined]) {
    const floorGB = getMinFreeGBForModelSize(mb);
    for (const short of [0.0001, 0.0049, 0.005, 0.0099]) {
      const availableGB = floorGB - short;
      const shown = Number(describeModelMemoryShortfall({ ok: false, availableGB, floorGB }).split('GB')[0]);
      assert.ok(shown < floorGB, `${availableGB} vs floor ${floorGB} printed as ${shown}`);
    }
  }
});

test('a measurement that threw has no figure to print, only the floor', () => {
  assert.equal(describeModelMemoryShortfall({ ok: true, availableGB: null, floorGB: 0.62 }), 'this model needs 0.62GB');
});

