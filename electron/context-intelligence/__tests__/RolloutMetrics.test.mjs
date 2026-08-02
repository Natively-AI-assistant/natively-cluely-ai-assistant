// Phase 10 §4/§5 — the rollout signals, and the vacuity guards on them.
//
// §4 opens with "none of them exist today". These tests exist to keep them
// existing AND to keep them honest: every signal is a rate, and a rate computed
// over zero turns reading 0% is the vacuous-gate failure this mission spent its
// investigation removing.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { recordTurnMetrics, getRolloutMetrics, evaluateAbortConditions, resetRolloutMetrics } =
  await import(pathToFileURL(path.join(base, 'observability/rollout-metrics.js')).href);

const turn = (over = {}) => ({
  engine: 'v3', status: 'COMPLETED', retrievalPath: 'GROUNDED',
  answerability: 'FULL', fallbackUsed: 'NONE',
  plannedSourceTypes: ['REFERENCE_FILE'],
  acceptedEvidence: [{ sourceType: 'REFERENCE_FILE', evidenceId: 'e1' }],
  retrievalAttempts: [{ rejections: [], failed: undefined }],
  timings: { providerTtfbMs: 100 },
  ...over,
});

describe('signals', () => {
  beforeEach(() => resetRolloutMetrics());

  test('a stale-version REJECTION is counted as the filter working, not as a leak', () => {
    recordTurnMetrics(turn({ retrievalAttempts: [{ rejections: [{ reason: 'SUPERSEDED_VERSION' }] }] }));
    const m = getRolloutMetrics();
    assert.equal(m.counters.retrieval.staleVersionRejectedTurns, 1);
    assert.equal(m.counters.contaminationTurns, 0, 'a rejection is not contamination');
    assert.equal(evaluateAbortConditions({ minTurns: 1 }).triggered.length, 0,
      'the filter doing its job must never trip an abort');
  });

  test('contamination is NOT COMPUTABLE without planned source types — null, never 0%', () => {
    // The signal's first implementation compared accepted evidence against a
    // field derived FROM that evidence (and compared strings to objects),
    // reporting 45.2% contamination on a corpus with none. A trace that cannot
    // support the check must report null.
    recordTurnMetrics(turn({ plannedSourceTypes: undefined }));
    const m = getRolloutMetrics();
    assert.equal(m.counters.contaminationCheckableTurns, 0);
    assert.equal(m.rates.contamination, null, 'unmeasurable must not read as clean');
  });

  test('contamination = an ACCEPTED item the turn never authorized, and it aborts on ANY occurrence', () => {
    recordTurnMetrics(turn({
      plannedSourceTypes: ['REFERENCE_FILE'],
      acceptedEvidence: [{ sourceType: 'JOB_DESCRIPTION', evidenceId: 'e9' }],
    }));
    assert.equal(getRolloutMetrics().counters.contaminationTurns, 1);
    assert.ok(evaluateAbortConditions({ minTurns: 1 }).triggered.includes('contamination_any'),
      '§5: any leak is an immediate rollback, not a trend to watch');
  });

  test('grounded-with-no-evidence is distinguished from a retrieval FAILURE', () => {
    recordTurnMetrics(turn({ acceptedEvidence: [], retrievalAttempts: [{ rejections: [] }] }));
    recordTurnMetrics(turn({ acceptedEvidence: [], retrievalAttempts: [{ rejections: [], failed: 'timeout' }] }));
    const c = getRolloutMetrics().counters.retrieval;
    assert.equal(c.groundedWithNoEvidenceTurns, 2);
    assert.equal(c.dependencyFailureTurns, 1,
      'the legacy path made these indistinguishable — both became {fallback:true}');
  });

  test('a FAST turn with no evidence is NOT a no-evidence grounded turn', () => {
    recordTurnMetrics(turn({ retrievalPath: 'FAST', acceptedEvidence: [], retrievalAttempts: [{ rejections: [] }] }));
    assert.equal(getRolloutMetrics().counters.retrieval.groundedWithNoEvidenceTurns, 0);
  });

  test('both engines land in the SAME counters, so stage exits are comparable', () => {
    recordTurnMetrics(turn({ engine: 'legacy' }));
    recordTurnMetrics(turn({ engine: 'v3' }));
    const m = getRolloutMetrics();
    assert.deepEqual(m.counters.engine, { legacy: 1, v3: 1 });
    assert.equal(m.rates.v3Share, 0.5);
  });

  test('supersession is tracked (F4)', () => {
    recordTurnMetrics(turn({ status: 'SUPERSEDED' }));
    assert.equal(getRolloutMetrics().counters.supersededTurns, 1);
  });
});

describe('vacuity and safety', () => {
  beforeEach(() => resetRolloutMetrics());

  test('rates are NULL with no data, never 0 — a green gate from zero turns is the bug', () => {
    const m = getRolloutMetrics();
    assert.equal(m.rates.contamination, null);
    assert.equal(m.latency.p95, null);
  });

  test('abort evaluation refuses to answer below the turn threshold', () => {
    recordTurnMetrics(turn());
    const a = evaluateAbortConditions({ minTurns: 50 });
    assert.equal(a.insufficientData, true);
    assert.deepEqual(a.triggered, [], 'and it reports nothing rather than "all clear"');
  });

  test('p95 regression beyond 20% aborts', () => {
    for (let i = 0; i < 60; i++) recordTurnMetrics(turn({ timings: { providerTtfbMs: 300 } }));
    assert.ok(evaluateAbortConditions({ minTurns: 50, baselineP95Ms: 200 }).triggered.includes('p95_regression_over_20pct'));
    assert.ok(!evaluateAbortConditions({ minTurns: 50, baselineP95Ms: 400 }).triggered.includes('p95_regression_over_20pct'));
  });

  test('over-refusal: strict refusals up while general fallback flat', () => {
    for (let i = 0; i < 60; i++) recordTurnMetrics(turn({ fallbackUsed: 'STRICT_NOT_FOUND', answerability: 'NONE' }));
    assert.ok(evaluateAbortConditions({ minTurns: 50 }).triggered.includes('over_refusal_suspected'),
      '§27.2 forbids hiding failures behind refusal');
  });

  test('malformed input can never throw into the answer path', () => {
    for (const bad of [null, undefined, {}, { retrievalAttempts: 'nope' }, { acceptedEvidence: 5 }]) {
      assert.doesNotThrow(() => recordTurnMetrics(bad));
    }
  });

  test('the latency buffer is bounded — a long meeting must not grow it forever', () => {
    for (let i = 0; i < 900; i++) recordTurnMetrics(turn());
    assert.ok(getRolloutMetrics().latency.samples <= 512);
  });

  test('no counter field can carry evidence text', () => {
    recordTurnMetrics(turn({ acceptedEvidence: [{ sourceType: 'REFERENCE_FILE', content: 'SECRET_TEXT' }] }));
    const blob = JSON.stringify(getRolloutMetrics());
    assert.ok(!blob.includes('SECRET_TEXT'), '§4: telemetry must not carry private evidence text');
  });
});
