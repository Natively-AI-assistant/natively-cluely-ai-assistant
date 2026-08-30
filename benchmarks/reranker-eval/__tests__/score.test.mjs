// benchmarks/reranker-eval/__tests__/score.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeCandidateMetrics, findDisagreements } from '../score.mjs';

const pools = [
  { queryId: 'q1', goldChunkPoolIndices: [1] },
  { queryId: 'q2', goldChunkPoolIndices: [0] },
  { queryId: 'q3', goldChunkPoolIndices: [] }, // gold missed the pool entirely
];

describe('computeCandidateMetrics', () => {
  test('a perfect candidate (gold always rank 0) scores MRR 1.0 and Recall@1 1.0, over resolvable queries only', () => {
    const result = {
      perQuery: [
        { queryId: 'q1', order: [1, 0, 2] }, // gold (pool idx 1) is rank 0 — correct
        { queryId: 'q2', order: [0, 1, 2] }, // gold (pool idx 0) is rank 0 — correct
        { queryId: 'q3', order: [0, 1, 2] }, // q3 has no resolvable gold — excluded from scoring
      ],
    };
    const m = computeCandidateMetrics(pools, result);
    assert.equal(m.mrr, 1);
    assert.equal(m.recallAt1, 1);
  });

  test('a candidate that always ranks gold last scores low MRR', () => {
    const result = {
      perQuery: [
        { queryId: 'q1', order: [0, 2, 1] }, // gold (idx 1) at rank 2 → 1/3
        { queryId: 'q2', order: [1, 2, 0] }, // gold (idx 0) at rank 2 → 1/3
      ],
    };
    const m = computeCandidateMetrics(pools, result);
    assert.equal(m.mrr, 1 / 3);
  });

  test('a failed/skipped candidate returns null (never throws, never fabricates a score)', () => {
    assert.equal(computeCandidateMetrics(pools, { failed: true, perQuery: [] }), null);
    assert.equal(computeCandidateMetrics(pools, { skipped: true, perQuery: [] }), null);
  });

  test('latency percentiles are computed from perQuery.latencyMs when present', () => {
    const result = {
      perQuery: [
        { queryId: 'q1', order: [1, 0, 2], latencyMs: 10 },
        { queryId: 'q2', order: [0, 1, 2], latencyMs: 20 },
      ],
      peakRssMb: 123.4,
    };
    const m = computeCandidateMetrics(pools, result);
    assert.equal(m.p50LatencyMs, 15); // simple average-of-two for n=2 is an acceptable p50 approximation
    assert.equal(m.peakRssMb, 123.4);
  });
});

const poolsWithText = [
  {
    queryId: 'q1',
    query: 'Tell me about a migration you led.',
    goldChunkPoolIndices: [1],
    pool: [{ text: 'irrelevant chunk about bananas' }, { text: 'the correct migration chunk' }, { text: 'another distractor' }],
  },
  {
    queryId: 'q2',
    query: 'What is your favorite color?',
    goldChunkPoolIndices: [0],
    pool: [{ text: 'the correct color chunk' }, { text: 'a distractor chunk' }],
  },
];

describe('findDisagreements', () => {
  test('returns a row only for queries where candidates pick different top chunks', () => {
    const candidateResults = [
      {
        name: 'candidate-a',
        result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [1, 0, 2] }, { queryId: 'q2', order: [0, 1] }] },
      },
      {
        name: 'candidate-b',
        result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [0, 1, 2] }, { queryId: 'q2', order: [0, 1] }] },
      },
    ];
    const disagreements = findDisagreements(poolsWithText, candidateResults);
    assert.equal(disagreements.length, 1, 'only q1 has disagreeing top picks; q2 agrees');
    assert.equal(disagreements[0].queryId, 'q1');
    assert.equal(disagreements[0].picks.length, 2);
    const byName = Object.fromEntries(disagreements[0].picks.map((p) => [p.name, p]));
    assert.equal(byName['candidate-a'].isGold, true, 'candidate-a picked the gold chunk (pool index 1)');
    assert.equal(byName['candidate-b'].isGold, false, 'candidate-b picked a non-gold chunk (pool index 0)');
  });

  test('failed/skipped candidates are excluded from the comparison, never crash it', () => {
    const candidateResults = [
      { name: 'candidate-a', result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [1, 0, 2] }] } },
      { name: 'candidate-b', result: { failed: true, skipped: false, perQuery: [] } },
    ];
    const disagreements = findDisagreements(poolsWithText.slice(0, 1), candidateResults);
    assert.equal(disagreements.length, 0, 'only one live candidate — nothing to disagree with');
  });

  test('respects the limit parameter', () => {
    const manyPools = Array.from({ length: 5 }, (_, i) => ({
      queryId: `q${i}`, query: `query ${i}`, goldChunkPoolIndices: [0], pool: [{ text: 'a' }, { text: 'b' }],
    }));
    const candidateResults = [
      { name: 'a', result: { failed: false, skipped: false, perQuery: manyPools.map((p) => ({ queryId: p.queryId, order: [0, 1] })) } },
      { name: 'b', result: { failed: false, skipped: false, perQuery: manyPools.map((p) => ({ queryId: p.queryId, order: [1, 0] })) } },
    ];
    const disagreements = findDisagreements(manyPools, candidateResults, 2);
    assert.equal(disagreements.length, 2);
  });
});
