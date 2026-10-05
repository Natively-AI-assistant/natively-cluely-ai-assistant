// Deviation from the task brief: the brief's import reads '../melFrontend.js'.
// This repo's electron/tsconfig.json compiles electron/**/*.ts to
// dist-electron/ (not in place next to the source — see NemotronCatalog.test.mjs
// and StartupModelValidation.test.mjs, which import the compiled output from
// dist-electron/electron/audio/whisper/... after an explicit build step).
// There is no melFrontend.js sitting next to melFrontend.ts, and Node does not
// fall back from a '.js' specifier to a sibling '.ts' file (confirmed
// empirically: ERR_MODULE_NOT_FOUND). Node 25's type-stripping support *does*
// load a '.ts' file directly, unflagged, so importing '../melFrontend.ts' here
// is the smallest change that makes `node --test
// electron/audio/whisper/nemotron/__tests__/melFrontend.test.mjs` actually run
// standalone (no prior `tsc` build step), while keeping this task independently
// testable as the brief intends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMelFrame, CHUNK_SAMPLES, N_MELS, N_FRAMES, LOG_EPS, LOOKBACK_SAMPLES,
  PRE_ENCODE_CACHE_SIZE,
} from '../melFrontend.ts';

test('computeMelFrame throws on wrong-length input', async () => {
  await assert.rejects(() => computeMelFrame(new Float32Array(100)));
});

test('computeMelFrame returns N_MELS x n_frames, no NaN/Inf, deterministic', async () => {
  const pcm = new Float32Array(CHUNK_SAMPLES);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 0.01) * 0.5;
  const a = await computeMelFrame(pcm);
  const b = await computeMelFrame(pcm);
  assert.equal(a.length % N_MELS, 0);
  // Pins the encoder's fixed audio_signal shape [1, 65, 128] that Task 4
  // depends on — not just "some multiple of N_MELS".
  assert.equal(a.length, N_FRAMES * N_MELS);
  assert.deepEqual(Array.from(a), Array.from(b));
  for (const v of a) assert.ok(Number.isFinite(v), `non-finite value: ${v}`);
});

test('silence produces the mel floor, not zero or NaN', async () => {
  const pcm = new Float32Array(CHUNK_SAMPLES); // all zeros
  const feats = await computeMelFrame(pcm);
  for (const v of feats) assert.ok(Number.isFinite(v) && v < -5, `expected a low log-floor value, got ${v}`);
});

// ---------------------------------------------------------------------------
// Golden-value regression protection (final-review-fix1 round, I2).
//
// The three tests above pass no matter which of the six ground-truth mel
// formula fixes (LOG_EPS at 2**-24, 'slaney' mel scale, 'slaney' filterbank
// norm, 'constant' STFT pad mode, centered window placement,
// LOOKBACK_SAMPLES=1760) is silently reverted — they only check shape,
// finiteness, determinism, and "below -5". These tests pin exact/near-exact
// values so a revert of any one of the six actually fails a test.
//
// Every value below was computed directly from this file's real
// computeMelFrame() (not hand-derived) and cross-checked against a
// standalone script that recomputes the same spectrogram() call with each
// of the six fixes individually reverted:
//   - LOG_EPS -> the old wrong 1e-10
//   - slaney norm/scale -> 'htk'/null
//   - pad_mode -> 'reflect'
//   - window -> left-aligned instead of centered
//   - add-not-clamp semantics (mel_floor:0/mel_offset:LOG_EPS, i.e.
//     log(x + LOG_EPS)) -> the old clamp form (mel_floor:LOG_EPS/
//     mel_offset:0, i.e. log(max(LOG_EPS, x))) — NOT distinguishable via
//     the silence test below: at x=0 both formulas reduce to log(LOG_EPS)
//     identically, so this can only be caught by a bin whose real mel power
//     sits near (not far above, not exactly at) the floor; bin 40 at each
//     frame checked below is such a bin (diffs of ~6e-4 to ~7e-3, all
//     comfortably above this test's EPS).
//   - LOOKBACK_SAMPLES -> covered separately below, by the two dedicated
//     invariant tests, not by this golden-value comparison
// every reverted variant changes at least one of the asserted frame/bin
// values below (pad_mode's effect is visible only at frame 64, the buffer's
// trailing edge; the other three formula fixes plus the clamp/add
// distinction are visible at every frame checked here).
// ---------------------------------------------------------------------------

function sineWave(n, freq = 0.01, phase = 0) {
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.sin((i + phase) * freq) * 0.5;
  return pcm;
}

test('computeMelFrame golden values for a lookback-fed sine chunk (pins all 6 formula constants)', async () => {
  const lookback = sineWave(LOOKBACK_SAMPLES, 0.01, 0);
  const chunk = sineWave(CHUNK_SAMPLES, 0.01, LOOKBACK_SAMPLES);
  const feats = await computeMelFrame(chunk, lookback);

  const EPS = 1e-4;
  const expected = {
    // frame: { bin: value }
    0:  { 0: -3.007749080657959,  40: -16.634239196777344, 127: -16.63553237915039 },
    20: { 0: -2.506613254547119,  40: -16.63490104675293,  127: -16.63553237915039 },
    // Frame 64 (the last of N_FRAMES) is the one frame whose 512-sample
    // window genuinely extends past the chunk's real audio — this is where
    // pad_mode:'constant' (vs the old, wrong 'reflect' guess) is visible;
    // every other frame checked above is insensitive to pad_mode.
    64: { 0: -2.566232442855835,  40: -11.685601234436035, 127: -11.617286682128906 },
  };

  for (const [frameStr, bins] of Object.entries(expected)) {
    const frame = Number(frameStr);
    for (const [binStr, value] of Object.entries(bins)) {
      const bin = Number(binStr);
      const actual = feats[frame * N_MELS + bin];
      assert.ok(
        Math.abs(actual - value) < EPS,
        `frame ${frame} bin ${bin}: expected ~${value}, got ${actual}`,
      );
    }
  }
});

test('silence produces exactly Math.fround(Math.log(LOG_EPS)) at every frame/bin, not just "< -5"', async () => {
  // Pure digital silence: mel power is exactly 0 (preemphasis and windowing
  // of an all-zero signal stay exactly 0), so mel_offset+max(mel_floor,0) ==
  // LOG_EPS exactly, and log(LOG_EPS) is the real floor value this pipeline
  // computes for silence -- not an arbitrary "below -5" threshold. The
  // output is a Float32Array, so the exact float64 Math.log(LOG_EPS) must be
  // rounded to float32 (Math.fround) before comparing, or every value
  // mismatches by ~4.6e-8 (the float32 rounding step itself, not a real
  // computation difference) -- confirmed empirically.
  const pcm = new Float32Array(CHUNK_SAMPLES);
  const feats = await computeMelFrame(pcm);
  const floor = Math.fround(Math.log(LOG_EPS));
  for (let i = 0; i < feats.length; i++) {
    assert.equal(feats[i], floor, `index ${i}: expected exact silence floor ${floor}, got ${feats[i]}`);
  }
});

test('LOOKBACK_SAMPLES is sufficient: leading PRE_ENCODE_CACHE_SIZE frames match a whole-signal computation with much more lookback', async () => {
  // The actual invariant LOOKBACK_SAMPLES(=1760, 11*HOP_LENGTH) exists to
  // guarantee: the leading PRE_ENCODE_CACHE_SIZE frames of a
  // LOOKBACK_SAMPLES-fed computeMelFrame call must be REAL mel frames from
  // the tail of the previous chunk, not corrupted by spectrogram()'s own
  // center:true zero-padding at the start of whatever buffer it's given.
  // computeMelFrame's lookback parameter isn't restricted to exactly
  // LOOKBACK_SAMPLES -- passing a much longer lookback is "one continuous
  // whole-signal computation over [lookback][chunk] concatenated" per the
  // function's own doc comment, and per LOOKBACK_SAMPLES' own derivation
  // (measured convergence from 11*HOP through 20*HOP), adding even more
  // lookback beyond 11*HOP must not change those leading frames further.
  const finalChunk = sineWave(CHUNK_SAMPLES, 0.019, 100000);
  const lookbackTail = sineWave(LOOKBACK_SAMPLES, 0.019, 100000 - LOOKBACK_SAMPLES);
  const historyExtra = LOOKBACK_SAMPLES * 4;
  const longHistory = sineWave(historyExtra, 0.019, 100000 - LOOKBACK_SAMPLES - historyExtra);
  const generousLookback = new Float32Array(historyExtra + LOOKBACK_SAMPLES);
  generousLookback.set(longHistory, 0);
  generousLookback.set(lookbackTail, historyExtra);

  const withNormalLookback = await computeMelFrame(finalChunk, lookbackTail);
  const withGenerousLookback = await computeMelFrame(finalChunk, generousLookback);

  for (let f = 0; f < PRE_ENCODE_CACHE_SIZE; f++) {
    for (let b = 0; b < N_MELS; b++) {
      const a = withNormalLookback[f * N_MELS + b];
      const c = withGenerousLookback[f * N_MELS + b];
      assert.ok(
        Math.abs(a - c) < 1e-4,
        `frame ${f} bin ${b}: LOOKBACK_SAMPLES lookback (${a}) diverged from generous-lookback ground truth (${c})`,
      );
    }
  }
});

test('LOOKBACK_SAMPLES sanity: an insufficient lookback DOES diverge (proves the test above isn\'t vacuous)', async () => {
  // Guards against the invariant test above passing FOR THE WRONG REASON
  // (e.g. computeMelFrame ignoring lookback entirely) -- a clearly too-short
  // lookback (5*HOP_LENGTH, well under the derived 11*HOP_LENGTH minimum)
  // must produce a real, large divergence in the leading frames versus the
  // same generous-lookback ground truth.
  const HOP_LENGTH = 160;
  const finalChunk = sineWave(CHUNK_SAMPLES, 0.019, 100000);
  const lookbackTail = sineWave(LOOKBACK_SAMPLES, 0.019, 100000 - LOOKBACK_SAMPLES);
  const historyExtra = LOOKBACK_SAMPLES * 4;
  const longHistory = sineWave(historyExtra, 0.019, 100000 - LOOKBACK_SAMPLES - historyExtra);
  const generousLookback = new Float32Array(historyExtra + LOOKBACK_SAMPLES);
  generousLookback.set(longHistory, 0);
  generousLookback.set(lookbackTail, historyExtra);

  const shortLookback = lookbackTail.slice(lookbackTail.length - 5 * HOP_LENGTH);
  const withShortLookback = await computeMelFrame(finalChunk, shortLookback);
  const withGenerousLookback = await computeMelFrame(finalChunk, generousLookback);

  let maxDiff = 0;
  for (let f = 0; f < PRE_ENCODE_CACHE_SIZE; f++) {
    for (let b = 0; b < N_MELS; b++) {
      maxDiff = Math.max(maxDiff, Math.abs(withShortLookback[f * N_MELS + b] - withGenerousLookback[f * N_MELS + b]));
    }
  }
  assert.ok(maxDiff > 1, `expected a large divergence with insufficient lookback, got max diff ${maxDiff}`);
});
