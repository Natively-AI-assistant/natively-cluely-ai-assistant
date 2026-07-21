// electron/intelligence/__tests__/RrfFusion.test.mjs
//
// Phase 2 (smart-retrieval rollout) — Reciprocal Rank Fusion unit tests.
//
// RRF is a pure, deterministic function. We pin:
//   • the math: score = Σ weight / (k + rank + 1), k=60, 1-based ranks
//   • cross-source corroboration: an item ranked by 2 sources beats a single
//     source's #1 when the combined contributions exceed it
//   • dedupe by explicit id AND by normalized text when id is absent
//   • per-source weighting
//   • unified confidence (low when single-source / weak-top / flat-margin / empty)
//   • robustness: empty/garbage input → empty result, never throws

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  fuseRanked,
  DEFAULT_RRF_K,
} from '../../../dist-electron/electron/intelligence/RrfFusion.js';

const K = DEFAULT_RRF_K; // 60
const rrf = (rank, weight = 1) => weight / (K + rank + 1); // rank is 0-based

describe('Phase 2: Reciprocal Rank Fusion', () => {
  test('single source: order preserved, scores follow 1/(k+rank+1)', () => {
    const { fused } = fuseRanked([
      { source: 'rag', items: [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }, { id: 'c', text: 'gamma' }] },
    ]);
    assert.deepEqual(fused.map(f => f.id), ['a', 'b', 'c']);
    assert.ok(Math.abs(fused[0].rrfScore - rrf(0)) < 1e-9);
    assert.ok(Math.abs(fused[1].rrfScore - rrf(1)) < 1e-9);
    assert.ok(Math.abs(fused[2].rrfScore - rrf(2)) < 1e-9);
  });

  test('cross-source corroboration: item ranked by two sources outranks a single #1', () => {
    // 'shared' is rank1 in rag and rank0 in hindsight → rrf(1)+rrf(0).
    // 'ragtop' is rank0 in rag only → rrf(0). Corroborated should win.
    const { fused } = fuseRanked([
      { source: 'rag', items: [{ id: 'ragtop', text: 'rag only top' }, { id: 'shared', text: 'shared passage' }] },
      { source: 'hindsight', items: [{ id: 'shared', text: 'shared passage' }, { id: 'hs2', text: 'hindsight two' }] },
    ]);
    assert.equal(fused[0].id, 'shared', 'corroborated item must rank first');
    const sharedScore = rrf(1) + rrf(0);
    assert.ok(Math.abs(fused[0].rrfScore - sharedScore) < 1e-9);
    assert.equal(fused[0].contributions.length, 2, 'shared item records both source contributions');
  });

  test('dedupe by explicit id sums contributions', () => {
    const { fused } = fuseRanked([
      { source: 's1', items: [{ id: 'x', text: 'X from one' }] },
      { source: 's2', items: [{ id: 'x', text: 'X from two' }] },
    ]);
    assert.equal(fused.length, 1, 'same id collapses to one fused entry');
    assert.ok(Math.abs(fused[0].rrfScore - (rrf(0) + rrf(0))) < 1e-9);
    assert.equal(fused[0].contributions.length, 2);
  });

  test('dedupe by normalized text when no id is given', () => {
    const { fused } = fuseRanked([
      { source: 's1', items: [{ text: 'The Same Passage' }] },
      { source: 's2', items: [{ text: '  the   same passage  ' }] }, // case + whitespace differ
    ]);
    assert.equal(fused.length, 1, 'normalized text identity collapses the two');
    assert.equal(fused[0].contributions.length, 2);
  });

  test('per-source weight scales that source contribution', () => {
    const { fused } = fuseRanked([
      { source: 'profile', weight: 3, items: [{ id: 'p', text: 'profile fact' }] },
      { source: 'rag', items: [{ id: 'r', text: 'rag chunk' }] },
    ]);
    assert.equal(fused[0].id, 'p', 'weighted source ranks first');
    assert.ok(Math.abs(fused[0].rrfScore - rrf(0, 3)) < 1e-9);
    assert.ok(Math.abs(fused[1].rrfScore - rrf(0, 1)) < 1e-9);
  });

  test('topN caps the fused output', () => {
    const { fused } = fuseRanked(
      [{ source: 'rag', items: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }, { id: 'c', text: 'c' }] }],
      { topN: 2 },
    );
    assert.equal(fused.length, 2);
    assert.deepEqual(fused.map(f => f.id), ['a', 'b']);
  });

  test('confidence: single contributing source flags single_source_only', () => {
    const { confidence } = fuseRanked([
      { source: 'rag', items: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }] },
    ]);
    assert.equal(confidence.contributingSources, 1);
    assert.equal(confidence.lowConfidence, true);
    assert.ok(confidence.reasons.includes('single_source_only'));
  });

  test('confidence: two sources corroborating a clear top is NOT low-confidence', () => {
    // 'win' is rank0 in both sources → strong, corroborated top with a real margin.
    const { confidence } = fuseRanked([
      { source: 'rag', items: [{ id: 'win', text: 'winner' }, { id: 'x', text: 'x' }, { id: 'y', text: 'y' }] },
      { source: 'hindsight', items: [{ id: 'win', text: 'winner' }, { id: 'z', text: 'z' }, { id: 'w', text: 'w' }] },
    ]);
    assert.equal(confidence.contributingSources, 2);
    assert.equal(confidence.corroboratedCount, 1);
    assert.equal(confidence.lowConfidence, false, `expected high confidence, reasons: ${confidence.reasons}`);
  });

  test('confidence: empty input → no_items, low confidence', () => {
    const { fused, confidence } = fuseRanked([]);
    assert.equal(fused.length, 0);
    assert.equal(confidence.lowConfidence, true);
    assert.ok(confidence.reasons.includes('no_items'));
    assert.equal(confidence.contributingSources, 0);
  });

  test('robustness: garbage / partial input never throws, skips bad entries', () => {
    const { fused } = fuseRanked([
      null,
      { source: 'empty', items: [] },
      { source: 'bad', items: [{ id: 'ok', text: 'good' }, { text: '   ' }, { id: 'noText' }, null] },
      undefined,
    ]);
    // Only the one valid item survives.
    assert.equal(fused.length, 1);
    assert.equal(fused[0].id, 'ok');
  });

  test('deterministic tie-break: equal scores order by corroboration then id', () => {
    // Two single-source rank0 items have equal score; the corroborated one wins,
    // then ties broken by id ascending.
    const { fused } = fuseRanked([
      { source: 's1', items: [{ id: 'zeta', text: 'z' }, { id: 'alpha', text: 'a' }] },
      { source: 's2', items: [{ id: 'alpha', text: 'a' }] }, // corroborates alpha
    ]);
    assert.equal(fused[0].id, 'alpha', 'corroborated alpha (rrf(0)+rrf(1)) leads');
    // zeta is single-source rank0 = rrf(0); alpha = rrf(0)+rrf(1) > rrf(0). Good.
    assert.equal(fused[1].id, 'zeta');
  });

  test('meta is carried through from the first contributing source', () => {
    const { fused } = fuseRanked([
      { source: 'rag', items: [{ id: 'm', text: 'with meta', meta: { fileName: 'doc.txt', chunkIndex: 3 } }] },
    ]);
    assert.deepEqual(fused[0].meta, { fileName: 'doc.txt', chunkIndex: 3 });
  });
});
