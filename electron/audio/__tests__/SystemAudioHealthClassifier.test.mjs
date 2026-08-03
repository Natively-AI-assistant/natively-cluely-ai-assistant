import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioHealthClassifier, peakToPeakInt16LE } from '../systemAudioHealthClassifier.mjs';

function zeroChunk(bytes = 1920) {
  return Buffer.alloc(bytes);
}

/**
 * A muted-but-DC-biased mic: every sample sits at a constant non-zero offset.
 * USB and Bluetooth hardware commonly biases by +/-10..+/-50 while capturing
 * no actual audio. This is the exact B10 failure case — see the DC-bias tests
 * at the bottom of this file.
 */
function dcBiasChunk(bias = 40, samples = 960) {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) chunk.writeInt16LE(bias, i * 2);
  return chunk;
}

/** A monotonic ramp spanning most of the int16 range — stands in for real audio. */
function loudRampChunk(samples = 960) {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    chunk.writeInt16LE(-4000 + Math.round((i * 8000) / (samples - 1)), i * 2);
  }
  return chunk;
}

/**
 * A full-amplitude pure tone at `freq`, with continuous phase across chunks so
 * a multi-chunk stream behaves like a real capture. Used for the aliasing
 * regression below — see toneChunk's callers for why the frequency matters.
 */
// The REAL emitted shape, measured against the native module rather than
// assumed: lib.rs computes `chunk_size = (emitted_rate / 1000) * 20`, and both
// captures emit 16kHz after the resampler — so 320 samples / 640 bytes per
// 20ms chunk. Using the true rate matters, because which frequencies alias
// depends entirely on it.
const CAPTURE_RATE = 16_000;
const CHUNK_SAMPLES = 320;
function toneChunk(freq, chunkIndex = 0, samples = CHUNK_SAMPLES, amp = 8000) {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const n = chunkIndex * samples + i;
    chunk.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * freq * n) / CAPTURE_RATE)), i * 2);
  }
  return chunk;
}

function rampChunk(samples = 960) {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = i % 2 === 0 ? -1000 : 1000;
    chunk.writeInt16LE(value, i * 2);
  }
  return chunk;
}

function assertNoUserWarning(decision) {
  assert.notEqual(decision.type, 'warn-user', `expected no user warning, got ${JSON.stringify(decision)}`);
}

test('no chunks after watchdog tick is log-only and never a user warning', () => {
  const health = new SystemAudioHealthClassifier({ watchdogMs: 12_000 });
  assertNoUserWarning(health.handle({ kind: 'capture-started', nowMs: 0 }));

  const decision = health.handle({ kind: 'watchdog-tick', nowMs: 12_000 });

  assert.equal(decision.type, 'log');
  assert.equal(decision.reason, 'initial-silence-no-chunks');
});

test('sustained zero-valued chunks are treated as silence, not permission failure', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decisions = [];
  for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
    const decision = health.handle({ kind: 'chunk', nowMs, chunk: zeroChunk() });
    assertNoUserWarning(decision);
    decisions.push(decision);
  }

  const silenceLog = decisions.find((decision) => decision.reason === 'sustained-zero-valued-silence');
  assert.equal(silenceLog?.type, 'log');
});

test('transcript absence cannot influence system-audio health classification', () => {
  const health = new SystemAudioHealthClassifier();
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decision = health.handle({ kind: 'watchdog-tick', nowMs: 45_000 });

  assertNoUserWarning(decision);
  assert.equal(
    SystemAudioHealthClassifier.supportedEventKinds.includes('transcript-missing'),
    false,
    'classifier API must not accept transcript absence as a system-audio failure signal',
  );
});

test('same-device route conflict emits one actionable user warning', () => {
  const health = new SystemAudioHealthClassifier();

  const first = health.handle({
    kind: 'same-device-route-detected',
    nowMs: 12_000,
    device: "Evin's AirPods Pro",
  });
  const duplicate = health.handle({
    kind: 'same-device-route-detected',
    nowMs: 13_000,
    device: "Evin's AirPods Pro",
  });

  assert.deepEqual(first, {
    type: 'warn-user',
    reason: 'same-device-input-output',
    device: "Evin's AirPods Pro",
    terminal: false,
    stuck: true,
  });
  assert.equal(duplicate.type, 'none');
});

// ---------------------------------------------------------------------------
// B10 regression: DC-offset invariance.
//
// These are the only fixtures in this file that DISCRIMINATE between the
// current peak-to-peak detector and the pre-B10 abs-peak one. The existing
// zero/ramp chunks are classified identically by both, so without these a
// revert to `Math.abs(sample) > 8` would keep the suite green.
//
// Pre-B10 bug: a muted mic with a constant +40 DC offset reads as abs-peak 40,
// which is > 8, so the detector latched "meaningful signal" and permanently
// disabled itself — the user got no mute/TCC banner on genuinely dead audio.
// Peak-to-peak reads (max - min) = 0 on the same input.
//
// The structural counterpart (no Math.abs, threshold is 100, wireSystemCapture
// still delegates here) lives in
// electron/services/__tests__/ZerofillDetectorPeakToPeak.test.mjs.
// ---------------------------------------------------------------------------

test('B10: a DC-biased silent chunk has zero peak-to-peak (abs-peak would report the bias)', () => {
  const biased = dcBiasChunk(40);

  assert.equal(
    peakToPeakInt16LE(biased),
    0,
    'a constant-offset chunk carries no signal — peak-to-peak must be 0 regardless of the offset',
  );
  // Negative bias must behave identically; abs-peak treats both as loud.
  assert.equal(peakToPeakInt16LE(dcBiasChunk(-40)), 0);
});

test('B10: real audio still registers as meaningful signal', () => {
  assert.ok(
    peakToPeakInt16LE(loudRampChunk()) > 100,
    'a full-range ramp must exceed the meaningful-signal threshold',
  );
});

test('B10: a DC-biased mic is still reported as sustained silence, not signal', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decisions = [];
  for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
    const decision = health.handle({ kind: 'chunk', nowMs, chunk: dcBiasChunk(40) });
    assertNoUserWarning(decision);
    decisions.push(decision);
  }

  // Under the pre-B10 abs-peak detector the +40 bias latched as signal on the
  // first chunk and this log would never be emitted.
  const silenceLog = decisions.find((decision) => decision.reason === 'sustained-zero-valued-silence');
  assert.equal(
    silenceLog?.type,
    'log',
    'a constantly-biased but silent capture must still be classified as sustained silence',
  );
});

// ---------------------------------------------------------------------------
// Aliasing regression: the detector must not subsample.
//
// A previous implementation strided ~32 points per chunk. At the real emitted
// shape (16kHz, 320-sample chunks) the stride was 10 samples, so any tone whose
// period divided 10 landed on an identical phase every time and measured
// peak-to-peak 0 at FULL amplitude. Because it aliased identically on every
// chunk, the "one loud chunk clears the latch" safeguard never fired, and the
// mic path raised a false "TCC denial or device-mute suspected" banner.
//
// 1600 and 3200 Hz alias at this chunk size; a batched 1920-byte chunk strides
// 30 samples and additionally aliases 533/1067/2667/5333 Hz. An off-by-one
// frequency (1601 Hz) does NOT alias, which is what made the old bug invisible
// to every fixture that was not exactly on a divisor.
//
// 8000 Hz is deliberately NOT tested: it is exactly Nyquist at 16kHz, so
// sin(2*pi*8000*n/16000) = sin(pi*n) = 0 for every integer sample. Such a tone
// is genuinely all-zero rather than aliased by the detector, and asserting it
// reads as signal would fail against a correct implementation.
// ---------------------------------------------------------------------------

test('B10: a full-amplitude tone at an aliasing frequency is not read as silence', () => {
  for (const freq of [1600, 3200]) {
    assert.ok(
      peakToPeakInt16LE(toneChunk(freq)) > 100,
      `a full-amplitude ${freq}Hz tone must register as signal (subsampling measured 0 here)`,
    );
  }
});

test('B10: an aliasing-frequency tone never latches sustained silence across the window', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  // 600 chunks x 20ms = 12s, the full observation window at the real cadence.
  const decisions = [];
  for (let chunkIndex = 0; chunkIndex < 600; chunkIndex++) {
    const nowMs = chunkIndex * 20;
    decisions.push(health.handle({ kind: 'chunk', nowMs, chunk: toneChunk(1600, chunkIndex) }));
  }

  assert.equal(
    decisions.some((decision) => decision.reason === 'sustained-zero-valued-silence'),
    false,
    'a continuous 1600Hz tone is audio, not silence — reporting it as silence is the aliasing bug',
  );
});

// ---------------------------------------------------------------------------
// One-way-latch safety: a lone transient must not disable silence reporting.
//
// hasMeaningfulSignal is cleared only by reset() on capture-started, so
// whatever sets it silences the diagnostic for the whole capture. Scanning
// every sample (rather than 1-in-30) made single-chunk transients reliably
// visible, so the latch needs its own evidence bar.
// ---------------------------------------------------------------------------

test('B10: one loud chunk among silence does not suppress the sustained-silence report', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decisions = [];
  for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
    // A single glitch chunk at t=2s, silence either side.
    const chunk = nowMs === 2000 ? loudRampChunk() : zeroChunk();
    decisions.push(health.handle({ kind: 'chunk', nowMs, chunk }));
  }

  const silenceLog = decisions.find((decision) => decision.reason === 'sustained-zero-valued-silence');
  assert.equal(
    silenceLog?.type,
    'log',
    'a dead capture that emitted one transient must still be reported as silent',
  );
});

test('B10: sustained real audio still latches and suppresses the silence report', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decisions = [];
  for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
    decisions.push(health.handle({ kind: 'chunk', nowMs, chunk: loudRampChunk() }));
  }

  assert.equal(
    decisions.some((decision) => decision.reason === 'sustained-zero-valued-silence'),
    false,
    'continuous audio must latch meaningful signal and suppress the silence report',
  );
});

test('B10: the latch threshold is configurable and takes effect at the boundary', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000, meaningfulChunkCount: 2 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  health.handle({ kind: 'chunk', nowMs: 0, chunk: loudRampChunk() });
  assert.equal(health.hasMeaningfulSignal, false, 'one chunk must not latch when two are required');

  health.handle({ kind: 'chunk', nowMs: 1000, chunk: loudRampChunk() });
  assert.equal(health.hasMeaningfulSignal, true, 'the second chunk must latch');
});

test('inter-chunk gaps are diagnostics only', () => {
  const health = new SystemAudioHealthClassifier({ interChunkGapLogMs: 2_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });
  assertNoUserWarning(health.handle({ kind: 'chunk', nowMs: 0, chunk: rampChunk() }));

  const decision = health.handle({ kind: 'chunk', nowMs: 3_000, chunk: rampChunk() });

  assert.equal(decision.type, 'log');
  assert.equal(decision.reason, 'inter-chunk-gap');
});
