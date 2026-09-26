// T6 (RC5) — combining retrieval ports destroyed the guarantees each port had
// just made.
//
// `combineRetrievalPorts` merged every port's already-capped output and then ran
// `evidence.sort((a, b) => b.finalScore - a.finalScore).slice(0, max)`.
//
// TWO SEPARATE DEFECTS IN THAT ONE LINE:
//
//   1. A port's output is not a bag of scored items, it is an ORDER. The
//      ACCEPTED-SLICE FILL (legacy-retrieval-port.ts:305-393) encodes three
//      policies into that order: the status partition (a retired document's
//      chunk must never outrank a current one — retired pricing beat active
//      pricing in a live run), a per-type round-robin reserving a slot for each
//      planned source type, and a per-document interleave. Re-sorting the union
//      by score discards all three.
//
//   2. It compared INCOMPARABLE SCALES. The profile port emits squashed BM25
//      plus fixed 0.6 policy admits (profile-retrieval-port.ts:497, :607-613);
//      the mode port passes the raw hybrid score straight through
//      (mode-retrieval-port.ts:236). With a resume and a reference file both in
//      play, whichever pool happens to score higher takes every accepted slot —
//      the exact outcome the per-type round-robin exists to prevent, undone one
//      layer up.
//
// The fix merges by RANK, the only quantity that means the same thing in both
// pools.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { combineRetrievalPorts } = await import(pathToFileURL(path.join(base, 'retrieval/meeting-retrieval-port.js')).href);

const ENV = 'NATIVELY_RETRIEVAL_PORT_COMBINATION_PRESERVES_SLOTS';
const withFlag = async (value, fn) => {
  const original = process.env[ENV];
  if (value === undefined) delete process.env[ENV]; else process.env[ENV] = value;
  try { return await fn(); } finally {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  }
};

/** A port returning a fixed, already-ordered evidence list. */
const portOf = (items) => ({
  async retrieve() {
    return {
      evidence: items.map((it, i) => ({
        evidenceId: `${it.sourceId}-${i}`, sourceType: it.sourceType, sourceId: it.sourceId,
        versionId: 'v1', scopeId: 'u', content: it.content, finalScore: it.finalScore,
        authorityFor: [], acceptedFor: [], isDirectFact: true, isInferred: false,
        metadata: {}, trustLevel: 'untrusted_reference',
      })),
      attempts: [],
    };
  },
});

const decisionWithCap = (max) => ({ decision: { retrievalPlan: { maximumAcceptedEvidence: max } } });

// The reported shape: a profile pool whose scores are systematically higher
// (fixed 0.6 policy admits and squashed BM25 both land high) beside a mode pool
// carrying the raw hybrid score for the reference file that actually answers.
const PROFILE = [
  { sourceId: 'resume', sourceType: 'RESUME', content: 'resume line one', finalScore: 0.90 },
  { sourceId: 'resume', sourceType: 'RESUME', content: 'resume line two', finalScore: 0.88 },
  { sourceId: 'resume', sourceType: 'RESUME', content: 'resume line three', finalScore: 0.86 },
  { sourceId: 'resume', sourceType: 'RESUME', content: 'resume line four', finalScore: 0.84 },
];
const MODE = [
  { sourceId: 'ref', sourceType: 'REFERENCE_FILE', content: 'the idempotency key format is IDK-OB-1', finalScore: 0.42 },
  { sourceId: 'ref', sourceType: 'REFERENCE_FILE', content: 'retries are 6 attempts', finalScore: 0.39 },
  { sourceId: 'ref', sourceType: 'REFERENCE_FILE', content: 'the DLQ is orbit-dlq', finalScore: 0.35 },
  { sourceId: 'ref', sourceType: 'REFERENCE_FILE', content: 'p95 SLO is 450 ms', finalScore: 0.31 },
];

describe('T6 — neither pool can take every accepted slot on magnitude alone', () => {
  test('the reference file survives beside a higher-scoring profile pool', async () => {
    const combined = combineRetrievalPorts([portOf(PROFILE), portOf(MODE)]);
    const { evidence } = await combined.retrieve(decisionWithCap(4));
    assert.equal(evidence.length, 4);
    const types = evidence.map((e) => e.sourceType);
    assert.ok(types.includes('REFERENCE_FILE'), `reference file crowded out entirely: ${types}`);
    assert.ok(types.includes('RESUME'), `profile crowded out entirely: ${types}`);
    // Rank round-robin: each port is represented before either contributes a
    // second item.
    assert.deepEqual(types, ['RESUME', 'REFERENCE_FILE', 'RESUME', 'REFERENCE_FILE']);
  });

  test('the kill switch reproduces the defect — the whole cap goes to one pool', async () => {
    // Asserting the OLD behaviour is what proves the new test is not vacuous:
    // if this passed under both settings, the fix would be doing nothing.
    await withFlag('0', async () => {
      const combined = combineRetrievalPorts([portOf(PROFILE), portOf(MODE)]);
      const { evidence } = await combined.retrieve(decisionWithCap(4));
      assert.deepEqual(evidence.map((e) => e.sourceType), ['RESUME', 'RESUME', 'RESUME', 'RESUME'],
        'flag OFF must reproduce the pre-fix magnitude-only sort');
    });
  });

  test('each port keeps its own internal ORDER', async () => {
    // The order encodes the status partition, per-type round-robin and
    // per-document interleave the port just applied. Nothing here may reorder it.
    const combined = combineRetrievalPorts([portOf(MODE)]);
    const { evidence } = await combined.retrieve(decisionWithCap(4));
    assert.deepEqual(evidence.map((e) => e.content), MODE.map((m) => m.content));
  });

  test('a deliberately LOW-scoring first item is not demoted', async () => {
    // The status-partition case in miniature: a port may rank a lower-scoring
    // chunk first on purpose (a current document above a retired one). A global
    // score sort silently inverts exactly that decision.
    const partitioned = [
      { sourceId: 'current', sourceType: 'REFERENCE_FILE', content: 'current pricing is 17 percent', finalScore: 0.20 },
      { sourceId: 'retired', sourceType: 'REFERENCE_FILE', content: 'retired pricing was 25 percent', finalScore: 0.95 },
    ];
    const combined = combineRetrievalPorts([portOf(partitioned)]);
    const { evidence } = await combined.retrieve(decisionWithCap(2));
    assert.equal(evidence[0].content, 'current pricing is 17 percent',
      'the port put the current document first; combining must not invert that');
  });
});

describe('T6 — the cap and the dedup still hold', () => {
  test('the turn cap is never exceeded, however many ports there are', async () => {
    const combined = combineRetrievalPorts([portOf(PROFILE), portOf(MODE), portOf(MODE)]);
    const { evidence } = await combined.retrieve(decisionWithCap(3));
    assert.equal(evidence.length, 3);
  });

  test('identical content across ports is emitted once', async () => {
    const same = [{ sourceId: 'a', sourceType: 'REFERENCE_FILE', content: 'IDENTICAL PASSAGE', finalScore: 0.5 }];
    const other = [{ sourceId: 'b', sourceType: 'RESUME', content: 'identical passage', finalScore: 0.7 }];
    const combined = combineRetrievalPorts([portOf(same), portOf(other)]);
    const { evidence } = await combined.retrieve(decisionWithCap(5));
    assert.equal(evidence.length, 1, `cross-port duplicate survived: ${evidence.map((e) => e.content)}`);
  });

  test('a port returning nothing does not stall the round-robin', async () => {
    const combined = combineRetrievalPorts([portOf([]), portOf(MODE)]);
    const { evidence } = await combined.retrieve(decisionWithCap(4));
    assert.equal(evidence.length, 4);
  });

  test('a THROWING port is recorded, not fatal — unchanged', async () => {
    const boom = { async retrieve() { throw new Error('pool offline'); } };
    const combined = combineRetrievalPorts([boom, portOf(MODE)]);
    const { evidence, attempts } = await combined.retrieve(decisionWithCap(4));
    assert.equal(evidence.length, 4);
    assert.ok(attempts.some((a) => a.failed), 'the failure must be recorded, never silently swallowed');
  });
});
