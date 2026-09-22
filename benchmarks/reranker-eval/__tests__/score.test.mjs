// benchmarks/reranker-eval/__tests__/score.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeCandidateMetrics, findDisagreements, isContentFreeChunk, findContentFreeTopPicks, renderReport } from '../score.mjs';

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

  test('exposes totalCount so callers know how many disagreeing queries were truncated', () => {
    const manyPools = Array.from({ length: 5 }, (_, i) => ({
      queryId: `q${i}`, query: `query ${i}`, goldChunkPoolIndices: [0], pool: [{ text: 'a' }, { text: 'b' }],
    }));
    const candidateResults = [
      { name: 'a', result: { failed: false, skipped: false, perQuery: manyPools.map((p) => ({ queryId: p.queryId, order: [0, 1] })) } },
      { name: 'b', result: { failed: false, skipped: false, perQuery: manyPools.map((p) => ({ queryId: p.queryId, order: [1, 0] })) } },
    ];
    const limited = findDisagreements(manyPools, candidateResults, 2);
    assert.equal(limited.length, 2);
    assert.equal(limited.totalCount, 5, 'totalCount reflects all 5 disagreements, not just the 2 shown');

    const unlimited = findDisagreements(manyPools, candidateResults, 15);
    assert.equal(unlimited.totalCount, 5, 'totalCount matches length when nothing was truncated');
  });

  test('topChunkText only gets an ellipsis when the underlying text was actually longer than the truncation length', () => {
    const poolsMixedLength = [
      {
        queryId: 'q1',
        query: 'q',
        goldChunkPoolIndices: [0],
        pool: [{ text: 'x'.repeat(100) }, { text: 'a short chunk' }],
      },
    ];
    const candidateResults = [
      { name: 'a', result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [0] }] } },
      { name: 'b', result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [1] }] } },
    ];
    const disagreements = findDisagreements(poolsMixedLength, candidateResults);
    const byName = Object.fromEntries(disagreements[0].picks.map((p) => [p.name, p]));
    assert.ok(byName['a'].topChunkText.endsWith('...'), 'a 100-char chunk truncated to 80 chars should end with an ellipsis');
    assert.equal(byName['a'].topChunkText.length, 83, '80 chars of content plus the 3-char ellipsis');
    assert.equal(byName['b'].topChunkText, 'a short chunk', 'a chunk under the truncation length must NOT get a fake ellipsis appended');
  });
});

describe('isContentFreeChunk', () => {
  test('flags a bare document-title chunk as content-free', () => {
    assert.equal(isContentFreeChunk('# Priya Nair'), true);
  });

  test('flags an empty section heading (with the [context: ...] annotation prefix) as content-free', () => {
    assert.equal(isContentFreeChunk('[context: Experience] ## Experience\n'), true);
  });

  test('flags a LONG bare title with no body as content-free — length alone must not be the only signal', () => {
    // A heading-only chunk whose title text happens to be long (a JD title,
    // not a short name) is still "bare" in the sense that matters: there is
    // no body underneath it. A pure character-count threshold would miss
    // this and undercount real content-free picks.
    assert.equal(isContentFreeChunk('# Senior Backend Engineer — CloudScale Systems'), true);
  });

  test('does not flag a heading with real body content', () => {
    assert.equal(isContentFreeChunk('[context: Education] ## Education\nB.S. Computer Science, University of Washington, 2019.'), false);
  });

  test('treats missing/empty text as content-free rather than throwing', () => {
    assert.equal(isContentFreeChunk(''), true);
    assert.equal(isContentFreeChunk(null), true);
  });
});

describe('findContentFreeTopPicks', () => {
  test('counts content-free #1 picks per live candidate across every query, excluding skipped/failed candidates', () => {
    const pools = [
      { queryId: 'q1', pool: [{ text: '# Priya Nair' }, { text: 'real content about a migration project' }] },
      { queryId: 'q2', pool: [{ text: '# Priya Nair' }, { text: 'more real content here' }] },
    ];
    const candidateResults = [
      { name: 'always-title', result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [0, 1] }, { queryId: 'q2', order: [0, 1] }] } },
      { name: 'always-real', result: { failed: false, skipped: false, perQuery: [{ queryId: 'q1', order: [1, 0] }, { queryId: 'q2', order: [1, 0] }] } },
      { name: 'skipped-one', result: { failed: false, skipped: true, perQuery: [] } },
    ];
    const stats = findContentFreeTopPicks(pools, candidateResults);
    assert.equal(stats.length, 2, 'the skipped candidate is excluded entirely');
    const byName = Object.fromEntries(stats.map((s) => [s.name, s]));
    assert.deepEqual(byName['always-title'], { name: 'always-title', count: 2, total: 2 });
    assert.deepEqual(byName['always-real'], { name: 'always-real', count: 0, total: 2 });
  });
});

describe('renderReport verdict scoping', () => {
  test('names a skipped candidate and states it remains unmeasured, rather than folding it into "no candidate clears the budget"', () => {
    const candidateMetrics = [
      { name: 'baseline', metrics: { mrr: 0.4, recallAt1: 0.3, recallAt3: 0.5, ndcg: 0.4, p50LatencyMs: 0, p95LatencyMs: 0, peakRssMb: null }, result: { skipped: false, failed: false } },
      { name: 'slow-winner', metrics: { mrr: 0.7, recallAt1: 0.6, recallAt3: 0.8, ndcg: 0.7, p50LatencyMs: 6000, p95LatencyMs: 6500, peakRssMb: 2000 }, result: { skipped: false, failed: false } },
      { name: 'cohere-rerank-v3.5', metrics: null, result: { skipped: true, failed: false } },
    ];
    const report = renderReport(candidateMetrics, []);
    assert.match(report, /cohere-rerank-v3\.5.*SKIPPED.*remains unmeasured/s);
    assert.match(report, /does not evaluate it/);
  });
});
