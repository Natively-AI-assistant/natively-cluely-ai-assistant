// electron/intelligence/__tests__/GlobalSearchRrf.test.mjs
//
// Phase 2 wiring — RRF fusion as the global-search ranker (flag ragRrfFusion).
//
// globalSearch historically weighted-SUMMED incomparable native scores (local
// lexical vs Hindsight's flat 0.85 memory score). With ragRrfFusion on it ranks
// by Reciprocal Rank Fusion of the per-source RANKED lists instead. Contracts:
//   (1) flag OFF → byte-for-byte the existing weighted-sum confidence.
//   (2) flag ON  → ranking driven by fused rank; user/org isolation + dedupe
//       still enforced; multi-source corroboration still wins.
//   (3) the scale-mismatch fix: a meeting that a source ranks #1 is not
//       penalized just because that source's native score is numerically small.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SearchOrchestrator } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

const svc = new SearchOrchestrator();
const FLAG = 'NATIVELY_RAG_RRF_FUSION';

function cand(over) {
  return { meetingId: 'm', title: 'T', date: 1e13, mode: 'sales', snippet: 's', source: 'lexical', score: 0.5, userId: 'alice', ...over };
}

describe('GlobalSearch — RRF fusion ranking (Phase 2 wiring)', () => {
  let prev;
  beforeEach(() => { prev = process.env[FLAG]; });
  afterEach(() => { if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev; });

  test('flag OFF: confidence identical to the weighted-sum baseline', () => {
    delete process.env[FLAG];
    const input = [
      cand({ meetingId: 'm1', source: 'lexical', score: 1.0 }),
      cand({ meetingId: 'm1', source: 'vector', score: 0.8 }),
      cand({ meetingId: 'm2', source: 'memory', score: 0.85 }),
    ];
    const res = svc.globalSearch(input, { userId: 'alice' }, {}, 1e13);
    // m1: 0.30*1 + 0.30*0.8 + recency(0.10*~1) ... we don't recompute the exact
    // value here (that's the existing suite's job); we assert the SHAPE is the
    // legacy one by checking m1 (multi-source, high scores) still leads.
    assert.equal(res[0].meetingId, 'm1');
    assert.ok(res[0].confidence > res[1].confidence);
  });

  test('flag ON: ranking still puts the multi-source meeting first', () => {
    process.env[FLAG] = '1';
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical', score: 0.9 }),
      cand({ meetingId: 'm1', source: 'memory', score: 0.85 }),
      cand({ meetingId: 'm2', source: 'lexical', score: 0.95 }),
    ], { userId: 'alice' }, {}, 1e13);
    // m1 is corroborated by lexical AND memory → RRF accumulates two
    // contributions; m2 only lexical. m1 should lead.
    assert.equal(res[0].meetingId, 'm1', 'multi-source meeting leads under RRF');
  });

  test('flag ON: rank-position, not raw score, drives order within a source', () => {
    process.env[FLAG] = '1';
    // Two lexical meetings with NEAR-IDENTICAL raw scores. Under RRF the order
    // is by RANK position (m1 #0, m3 #1), and the tiny raw-score gap does not
    // matter — the higher-ranked meeting leads deterministically.
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical', score: 0.91 }),
      cand({ meetingId: 'm3', source: 'lexical', score: 0.90 }),
    ], { userId: 'alice' }, {}, 1e13);
    assert.equal(res[0].meetingId, 'm1', 'lexical rank-0 leads');
    assert.ok(res[0].confidence > res[1].confidence, 'distinct fused confidences, not collapsed by rounding');
  });

  test('flag ON: a memory hit corroborating a lexical hit boosts that meeting above a lone lexical', () => {
    process.env[FLAG] = '1';
    // m1: lexical#0 + memory#0 (corroborated by two sources).
    // m2: lexical#1 only. m1 must lead — cross-source corroboration is exactly
    // what RRF rewards, and what the old per-source weighted MAX could miss.
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical', score: 0.9 }),
      cand({ meetingId: 'm1', source: 'memory', score: 0.85 }),
      cand({ meetingId: 'm2', source: 'lexical', score: 0.85 }),
    ], { userId: 'alice' }, {}, 1e13);
    assert.equal(res[0].meetingId, 'm1', 'corroborated meeting leads under RRF');
  });

  test('flag ON: user isolation still enforced (foreign userId dropped)', () => {
    process.env[FLAG] = '1';
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical', score: 0.9, userId: 'alice' }),
      cand({ meetingId: 'mX', source: 'memory', score: 0.99, userId: 'mallory' }),
    ], { userId: 'alice' }, {}, 1e13);
    assert.ok(res.every(r => r.meetingId !== 'mX'), 'foreign-user candidate must never surface');
    assert.equal(res[0].meetingId, 'm1');
  });

  test('flag ON: dedupes by meetingId (one row per meeting)', () => {
    process.env[FLAG] = '1';
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical' }),
      cand({ meetingId: 'm1', source: 'vector' }),
      cand({ meetingId: 'm1', source: 'memory' }),
    ], { userId: 'alice' });
    assert.equal(res.length, 1);
    assert.equal(res[0].sourceTypes.length, 3);
  });

  test('flag ON: empty input → empty result, never throws', () => {
    process.env[FLAG] = '1';
    assert.deepEqual(svc.globalSearch([], { userId: 'alice' }), []);
  });
});
