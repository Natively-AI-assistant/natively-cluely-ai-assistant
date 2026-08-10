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
import { computeMelFrame, CHUNK_SAMPLES, N_MELS, N_FRAMES } from '../melFrontend.ts';

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
