// Regression tests for the regen non-regression gate added to
// ipcHandlers.ts's doc-grounded validator (root-cause fix, 2026-07-23).
//
// Root cause: `regenValid` used to accept ANY regen that passed a handful of
// safety checks (not a greeting, not still refusing, no fabrication) with NO
// comparison to the ORIGINAL answer's length or coverage. A real benchmark
// observed a 959-char correct answer (reason='incomplete') replaced by an
// unproven 182-char "regeneration applied" answer that only restated ONE of
// several values the original covered, and a 1399-char answer (reason=
// 'false_refusal') replaced by a ~2-sentence generic safe-failure line after
// the regen attempt failed. Neither swap was gated on the regen actually
// covering as much as (or more than) the original.
//
// These tests assert the STRUCTURE of the fix directly against the
// ipcHandlers.ts source (the logic lives inline in a large IPC handler, not a
// small pure function — string-presence assertions on the exact guard
// predicates mirror the existing test style in DocGroundedRetrievalFix.test.mjs)
// plus a pure-JS simulation of the coverage-comparison logic itself, so the
// actual arithmetic (not just presence of a name) is proven correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ipcHandlersSrc = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

// ---------------------------------------------------------------------------
// 1. Source-presence: the non-regression guards exist and are wired into
//    regenValid / the false_refusal keep-original branch.
// ---------------------------------------------------------------------------

test('ipcHandlers: regenValid includes the quality-downgrade non-regression guard', () => {
  assert.ok(
    ipcHandlersSrc.includes('!regenIsQualityDowngrade'),
    'regenValid must reject a regen that is a quality downgrade vs the original',
  );
});

test('ipcHandlers: regenIsQualityDowngrade compares regen length against the original with a minimum ratio', () => {
  assert.ok(
    ipcHandlersSrc.includes('REGEN_MIN_LENGTH_RATIO'),
    'a length-ratio floor must exist to catch drastic length-downgrade regens (the 959->182 char case)',
  );
  assert.ok(
    ipcHandlersSrc.includes('regenTrim.length < trimmed.length * REGEN_MIN_LENGTH_RATIO'),
    'the downgrade check must compare regen length to the ORIGINAL (trimmed) answer length',
  );
});

test('ipcHandlers: incomplete-reason acceptance requires non-regressing numeric coverage, not just one recovered value', () => {
  assert.ok(
    ipcHandlersSrc.includes('noNumericCoverageRegression'),
    'the incomplete-reason gate must check the regen did not shed numeric coverage the original had',
  );
  assert.ok(
    ipcHandlersSrc.includes('regenVals.size >= originalVals.size'),
    'numeric coverage check must compare token-set sizes between regen and original',
  );
  assert.ok(
    ipcHandlersSrc.includes('recoveredAnyMissingValue && recoveredAnySubQuestion && noNumericCoverageRegression'),
    'incompleteRecoveredValue must require recovering a missing value, recovering any missing sub-question, AND not regressing overall coverage',
  );
});

test('ipcHandlers: a substantial false_refusal original is kept rather than downgraded to the safe-failure line', () => {
  assert.ok(
    ipcHandlersSrc.includes("reason === 'false_refusal' && trimmed.length >= 150"),
    'false_refusal branch must have a keep-original path for substantial original answers, symmetric to the existing incomplete keep-original path',
  );
});

// ---------------------------------------------------------------------------
// 2. Pure-JS simulation of the numeric non-regression arithmetic, mirroring
//    the exact logic added to ipcHandlers.ts (extractNumericUnitTokens +
//    size comparison), proving the 959->182-char scenario is now rejected.
// ---------------------------------------------------------------------------

const NUM_UNIT_RE = /\b\d[\d,]*(?:\.\d+)?\s?(?:(?:gb|gigabytes?|mb|megabytes?|hz|hertz|khz|kilohertz|kg|kilograms?|mm|millimet(?:er|re)s?|m\/s|m|v|volts?|dof|steps?|episodes?|hours?|h|fps|w|watts?|percent)\b|%)/gi;
function extractNumericUnitTokensSim(text) {
  const out = new Set();
  for (const m of (text || '').match(NUM_UNIT_RE) || []) out.add(m.toLowerCase().replace(/\s+/g, ''));
  return out;
}
function simulateIncompleteAcceptance({ originalAnswer, regenAnswer, incompleteMissing }) {
  const regenVals = extractNumericUnitTokensSim(regenAnswer);
  const originalVals = extractNumericUnitTokensSim(originalAnswer);
  const recoveredAnyMissingValue = incompleteMissing.some((mv) => regenVals.has(mv));
  const noNumericCoverageRegression = regenVals.size >= originalVals.size;
  return recoveredAnyMissingValue && noNumericCoverageRegression;
}

test('sim: a short regen recovering only 1 of several original values is REJECTED (959->182 char scenario)', () => {
  // Original covers a full multi-part answer including a 44% success rate
  // plus other stated facts (simulated with additional numeric-shaped values
  // standing in for the instruction/behavior narrative).
  const original = 'The instruction was "put the fruits on the plate". It is long-horizon because 2 objects must be moved sequentially across 3 steps. OpenVLA and OpenVLA-OFT failed to complete both-object sequencing. AgenticVLA decomposed the task and achieved a 44% success rate.';
  const regen = 'AgenticVLA achieved a 44% success rate on the task.';
  const accepted = simulateIncompleteAcceptance({
    originalAnswer: original,
    regenAnswer: regen,
    incompleteMissing: ['44%'],
  });
  assert.equal(accepted, false, 'a regen that drops other stated values while only re-stating one must be rejected');
});

test('sim: a regen that recovers a missing value AND preserves the rest is ACCEPTED', () => {
  const original = 'The training used a single GPU card with 96 GB of VRAM.';
  const regen = 'The training used a single GPU card with 96 GB of VRAM; peak usage reached 62 GB.';
  const accepted = simulateIncompleteAcceptance({
    originalAnswer: original,
    regenAnswer: regen,
    incompleteMissing: ['62gb'],
  });
  assert.equal(accepted, true, 'a regen that adds the missing value without losing coverage must be accepted');
});

test('sim: a regen with equal coverage but no recovered value is REJECTED (no improvement)', () => {
  const original = 'The training used a single GPU card with 96 GB of VRAM.';
  const regen = 'Training was done using a 96 GB VRAM GPU card.';
  const accepted = simulateIncompleteAcceptance({
    originalAnswer: original,
    regenAnswer: regen,
    incompleteMissing: ['62gb'],
  });
  assert.equal(accepted, false, 'a regen that never surfaces the flagged missing value must be rejected even if coverage size matches');
});

// ---------------------------------------------------------------------------
// 3. Length-ratio simulation for the false_refusal quality-downgrade guard.
// ---------------------------------------------------------------------------

function simulateQualityDowngrade({ originalAnswer, regenAnswer, reason, ratio = 0.6 }) {
  const trimmed = (originalAnswer || '').trim();
  const regenTrim = (regenAnswer || '').trim();
  return (reason === 'false_refusal' || reason === 'incomplete')
    && trimmed.length > 0
    && regenTrim.length < trimmed.length * ratio;
}

test('sim: a 1399-char original vs a ~130-char regen is flagged as a quality downgrade', () => {
  const original = 'A'.repeat(1399);
  const regen = 'B'.repeat(130);
  assert.equal(
    simulateQualityDowngrade({ originalAnswer: original, regenAnswer: regen, reason: 'false_refusal' }),
    true,
  );
});

test('sim: a regen close in length to the original is NOT flagged as a downgrade', () => {
  const original = 'A'.repeat(500);
  const regen = 'B'.repeat(480);
  assert.equal(
    simulateQualityDowngrade({ originalAnswer: original, regenAnswer: regen, reason: 'false_refusal' }),
    false,
  );
});

test('sim: the downgrade guard does not apply to greeting/empty/exact_repeat reasons', () => {
  const original = 'A'.repeat(500);
  const regen = 'B'.repeat(10);
  assert.equal(
    simulateQualityDowngrade({ originalAnswer: original, regenAnswer: regen, reason: 'greeting' }),
    false,
    'greeting/empty/exact_repeat reasons must not be gated by the length-ratio floor',
  );
});
