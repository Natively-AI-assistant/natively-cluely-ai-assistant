// Unit tests for electron/audio/whisper/audioResampler.ts — resampleToF32()
// turns an Int16LE PCM Buffer at any sample rate into a normalised
// Float32Array at 16 kHz using linear interpolation.
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
// Run from the repo root:
//   node --test electron/audio/whisper/__tests__/AudioResampler.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const { resampleToF32 } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'whisper', 'audioResampler.js'),
);

/** Int16LE PCM buffer from a list of sample values. */
function pcm(values) {
  const buf = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  return buf;
}

// All test samples are multiples of 2^-15 with short mantissas, so the
// expected values are exact in float32 and can be compared with deepEqual.
const f32 = (values) => Float32Array.from(values);

describe('resampleToF32 — 16 kHz passthrough', () => {
  test('normalises Int16 to [-1, 1) without changing the length', () => {
    const out = resampleToF32(pcm([0, 16384, -16384, 8192, -8192]), 16000);
    assert.ok(out instanceof Float32Array);
    assert.deepEqual(out, f32([0, 0.5, -0.5, 0.25, -0.25]));
  });

  test('full-scale values map to -1 and 32767/32768', () => {
    const out = resampleToF32(pcm([-32768, 32767, 1, -1]), 16000);
    assert.deepEqual(out, f32([-1, 32767 / 32768, 1 / 32768, -1 / 32768]));
    for (const v of out) assert.ok(v >= -1 && v < 1);
  });

  test('bytes are read little-endian', () => {
    // 0x00 0x40 -> 0x4000 = 16384 -> 0.5 ; 0x00 0xC0 -> 0xC000 = -16384 -> -0.5
    const out = resampleToF32(Buffer.from([0x00, 0x40, 0x00, 0xc0]), 16000);
    assert.deepEqual(out, f32([0.5, -0.5]));
  });

  test('an empty buffer yields an empty array', () => {
    const out = resampleToF32(Buffer.alloc(0), 16000);
    assert.ok(out instanceof Float32Array);
    assert.equal(out.length, 0);
  });

  test('a single sample survives', () => {
    assert.deepEqual(resampleToF32(pcm([8192]), 16000), f32([0.25]));
  });

  test('respects the byteOffset of a Buffer that is a view into a larger one', () => {
    const big = pcm([111, 222, 16384, -16384, 333]);
    const view = big.subarray(4, 8);
    assert.deepEqual(resampleToF32(view, 16000), f32([0.5, -0.5]));
  });

  test('does not modify the input buffer', () => {
    const buf = pcm([100, -200, 300, -400, 500, -600]);
    const before = Buffer.from(buf);
    resampleToF32(buf, 16000);
    resampleToF32(buf, 48000);
    assert.ok(buf.equals(before));
  });
});

describe('resampleToF32 — downsampling', () => {
  test('48 kHz -> 16 kHz keeps every 3rd sample', () => {
    const out = resampleToF32(pcm([0, 1024, 2048, 4096, 5120, 6144, 8192, 9216, 10240]), 48000);
    assert.deepEqual(out, f32([0, 4096 / 32768, 8192 / 32768]));
  });

  test('32 kHz -> 16 kHz keeps every 2nd sample', () => {
    const out = resampleToF32(pcm([0, 4096, 8192, 12288, 16384, 20480]), 32000);
    assert.deepEqual(out, f32([0, 0.25, 0.5]));
  });

  test('24 kHz -> 16 kHz interpolates linearly between neighbours', () => {
    // ratio 1.5: out[0] = in[0]; out[1] = midpoint of in[1] and in[2].
    const out = resampleToF32(pcm([0, 8192, 16384]), 24000);
    assert.deepEqual(out, f32([0, 0.375]));
  });

  test('24 kHz -> 16 kHz over six samples', () => {
    // in/32768 = [0, .125, .25, .375, .5, .625]; positions 0, 1.5, 3, 4.5
    const out = resampleToF32(pcm([0, 4096, 8192, 12288, 16384, 20480]), 24000);
    assert.deepEqual(out, f32([0, 0.1875, 0.375, 0.5625]));
  });

  test('output length is round(inputSamples * 16000 / rate)', () => {
    assert.equal(resampleToF32(Buffer.alloc(441 * 2), 44100).length, 160);
    assert.equal(resampleToF32(Buffer.alloc(480 * 2), 48000).length, 160);
    assert.equal(resampleToF32(Buffer.alloc(4 * 2), 48000).length, 1);   // 1.33 -> 1
    assert.equal(resampleToF32(Buffer.alloc(5 * 2), 48000).length, 2);   // 1.67 -> 2
    assert.equal(resampleToF32(Buffer.alloc(1 * 2), 48000).length, 0);   // 0.33 -> 0
  });

  test('a rounded-up output length still reads in-range samples', () => {
    // 5 samples at 48 kHz -> 2 outputs: in[0] and in[3].
    const out = resampleToF32(pcm([4096, 1, 2, 8192, 3]), 48000);
    assert.deepEqual(out, f32([0.125, 0.25]));
  });

  test('an empty buffer yields an empty array at a non-16 kHz rate too', () => {
    const out = resampleToF32(Buffer.alloc(0), 48000);
    assert.ok(out instanceof Float32Array);
    assert.equal(out.length, 0);
  });

  test('a constant signal stays constant', () => {
    const out = resampleToF32(pcm(new Array(441).fill(8192)), 44100);
    assert.equal(out.length, 160);
    for (const v of out) assert.equal(v, 0.25);
  });

  test('silence stays silent', () => {
    const out = resampleToF32(Buffer.alloc(960), 48000);
    assert.equal(out.length, 160);
    assert.ok(out.every((v) => v === 0));
  });
});

describe('resampleToF32 — upsampling', () => {
  test('8 kHz -> 16 kHz doubles the length, inserting midpoints', () => {
    const out = resampleToF32(pcm([0, 16384, -16384]), 8000);
    // positions 0, .5, 1, 1.5, 2, 2.5 — the final half-step has no right
    // neighbour and holds the last sample.
    assert.deepEqual(out, f32([0, 0.25, 0.5, 0, -0.5, -0.5]));
  });

  test('a single 8 kHz sample is held for both output samples', () => {
    assert.deepEqual(resampleToF32(pcm([8192]), 8000), f32([0.25, 0.25]));
  });

  test('output never exceeds the input range', () => {
    const out = resampleToF32(pcm([-32768, 32767, -32768, 32767]), 8000);
    assert.equal(out.length, 8);
    for (const v of out) assert.ok(v >= -1 && v < 1);
  });
});
