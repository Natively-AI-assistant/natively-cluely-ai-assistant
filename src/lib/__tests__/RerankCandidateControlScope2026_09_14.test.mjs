// "Candidates to rerank" is a hosted-path control (2026-09-14).
//
// What the knob buys depends entirely on which reranker is running, and the
// panel presented it as if it did not:
//
//   LOCAL cross-encoder — the pool splits into batches of RERANK_BATCH_SIZE (6),
//   so 30 candidates is ~5 sequential forward passes at tens of ms each, well
//   inside the 1200ms bundled budget. Lowering the pool buys no latency worth
//   having and costs recall on every query. There is nothing here for a user to
//   decide.
//
//   HOSTED and EXTENSION ports — both declare batchSize = MAX_SAFE_INTEGER, so
//   the whole pool travels in ONE round trip. Pool size maps directly to
//   passages billed, and to whether the round trip finishes inside the 3000ms
//   live / 8000ms manual budget at all. This is the only lever the user has
//   over either, and it is a real one.
//
// So the control is shown where it decides something and hidden where it can
// only make retrieval worse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { candidateControlApplies, candidateControlRationale }
  from '../rerankCandidateControl.mjs';

describe('where the control applies', () => {
  test('hidden for the local cross-encoder — every choice only lowers recall', () => {
    assert.equal(candidateControlApplies('local'), false);
  });

  test('shown for every port whose cost is a round trip', () => {
    for (const kind of ['natively', 'openrouter', 'jina', 'extension']) {
      assert.equal(candidateControlApplies(kind), true, kind);
    }
  });

  test('an unknown kind shows the control rather than hiding a real lever', () => {
    // Hiding on an unrecognised value would silently remove the only cost
    // control the moment a new hosted provider lands.
    assert.equal(candidateControlApplies('some-future-provider'), true);
    assert.equal(candidateControlApplies(undefined), true);
    assert.equal(candidateControlApplies(null), true);
  });
});

describe('the rationale is specific to the active port', () => {
  test('hosted framing names the cost the user is actually paying', () => {
    const r = candidateControlRationale('openrouter');
    assert.match(r, /passage/i);
    assert.ok(/cost|bill|pay|spend/i.test(r), `hosted copy must name the cost: ${r}`);
  });

  test('extension framing is the round-trip one, not the billing one', () => {
    const r = candidateControlRationale('extension');
    assert.match(r, /passage/i);
    assert.ok(!/bill|spend/i.test(r),
      `a local extension is not billed per passage: ${r}`);
  });

  test('there is no local rationale, because there is no local control', () => {
    assert.equal(candidateControlRationale('local'), null);
  });
});
