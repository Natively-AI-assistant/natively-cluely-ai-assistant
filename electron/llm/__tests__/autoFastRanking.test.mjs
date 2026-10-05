// electron/llm/__tests__/autoFastRanking.test.mjs
//
// Unit tests for electron/llm/performance/autoFastRanking.ts — ordering Fast
// Response Mode's Auto candidates by the user's own measurements. Pure:
// evidence in, order out.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/autoFastRanking.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
  AUTO_FAST_WORKLOAD,
  AUTO_FAST_MIN_SAMPLES,
  AUTO_FAST_MIN_ATTEMPTS,
  AUTO_FAST_MIN_SUCCESS_RATE,
  AUTO_FAST_SWITCH_MARGIN,
  autoFastEvidence,
  orderAutoFastCandidates,
} = require(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'performance', 'autoFastRanking.js'));

const reliability = (over = {}) => ({
  ok: 0, timeout: 0, stall: 0, rateLimit: 0, serverError: 0, clientError: 0, connectionFailure: 0, ...over,
});
/** One workload bucket: `count` first-token samples at `p50Ms`, plus reliability counters. */
const bucket = (p50Ms, count, rel) => ({ ttft: { p50Ms, count }, reliability: rel === null ? undefined : reliability(rel) });
const profile = (workloads) => ({ workloads });

/** A candidate with evidence: measured (>= min samples) and fully reliable unless overridden. */
const cand = (name, p50Ms, over = {}) => ({
  name,
  evidence: p50Ms === null ? null : { p50Ms, samples: 10, attempts: 10, successRate: 1, ...over },
});
const names = (list) => list.map((c) => c.name);

describe('constants', () => {
  test('hold the documented thresholds', () => {
    assert.equal(AUTO_FAST_WORKLOAD, 'small');
    assert.equal(AUTO_FAST_MIN_SAMPLES, 3);
    assert.equal(AUTO_FAST_MIN_ATTEMPTS, 5);
    assert.equal(AUTO_FAST_MIN_SUCCESS_RATE, 0.8);
    assert.equal(AUTO_FAST_SWITCH_MARGIN, 0.15);
  });
});

describe('autoFastEvidence', () => {
  test('no profiles, or only null/undefined ones, is null', () => {
    assert.equal(autoFastEvidence([]), null);
    assert.equal(autoFastEvidence([null, undefined]), null);
  });

  test('a profile with no workloads at all is null', () => {
    assert.equal(autoFastEvidence([{}]), null);
    assert.equal(autoFastEvidence([profile({})]), null);
  });

  test('reads the "small" bucket by default', () => {
    const p = profile({ small: bucket(420, 7, { ok: 9, timeout: 1 }) });
    assert.deepEqual(autoFastEvidence([p]), { p50Ms: 420, samples: 7, attempts: 10, successRate: 0.9 });
  });

  test('evidence only in another bucket counts as unmeasured', () => {
    const p = profile({ medium: bucket(300, 50, { ok: 50 }), large: bucket(900, 20, { ok: 20 }) });
    assert.equal(autoFastEvidence([p]), null);
  });

  test('an explicit workload selects that bucket', () => {
    const p = profile({ small: bucket(400, 5, { ok: 5 }), medium: bucket(800, 4, { ok: 4 }) });
    assert.deepEqual(autoFastEvidence([p], 'medium'), { p50Ms: 800, samples: 4, attempts: 4, successRate: 1 });
  });

  test('attempts is the sum of every reliability counter; successRate is ok/attempts', () => {
    const p = profile({
      small: bucket(500, 3, { ok: 3, timeout: 1, stall: 1, rateLimit: 1, serverError: 1, clientError: 1, connectionFailure: 2 }),
    });
    assert.deepEqual(autoFastEvidence([p]), { p50Ms: 500, samples: 3, attempts: 10, successRate: 0.3 });
  });

  test('missing reliability counters mean zero attempts and a null success rate', () => {
    const p = profile({ small: bucket(500, 4, null) });
    assert.deepEqual(autoFastEvidence([p]), { p50Ms: 500, samples: 4, attempts: 0, successRate: null });
  });

  test('a bucket with samples but no attempts has a null success rate', () => {
    const p = profile({ small: bucket(500, 4, {}) });
    assert.deepEqual(autoFastEvidence([p]), { p50Ms: 500, samples: 4, attempts: 0, successRate: null });
  });

  test('attempts with zero latency samples is still evidence', () => {
    const p = profile({ small: bucket(0, 0, { timeout: 6 }) });
    assert.deepEqual(autoFastEvidence([p]), { p50Ms: 0, samples: 0, attempts: 6, successRate: 0 });
  });

  test('an entirely empty bucket is not evidence', () => {
    assert.equal(autoFastEvidence([profile({ small: bucket(0, 0, {}) })]), null);
  });

  test('across several profiles the one with the most samples wins, whole', () => {
    const few = profile({ small: bucket(200, 2, { ok: 2 }) });
    const many = profile({ small: bucket(900, 12, { ok: 10, timeout: 2 }) });
    const expected = { p50Ms: 900, samples: 12, attempts: 12, successRate: 10 / 12 };
    assert.deepEqual(autoFastEvidence([few, many]), expected);
    assert.deepEqual(autoFastEvidence([many, few]), expected);
  });

  test('a tie on samples keeps the earlier profile', () => {
    const first = profile({ small: bucket(300, 5, { ok: 5 }) });
    const second = profile({ small: bucket(700, 5, { ok: 5 }) });
    assert.equal(autoFastEvidence([first, second]).p50Ms, 300);
  });

  test('null entries between real profiles are skipped', () => {
    const p = profile({ small: bucket(250, 3, { ok: 3 }) });
    assert.deepEqual(autoFastEvidence([null, p, undefined]), { p50Ms: 250, samples: 3, attempts: 3, successRate: 1 });
  });
});

describe('orderAutoFastCandidates: unmeasured candidates', () => {
  test('an empty list stays empty', () => {
    assert.deepEqual(orderAutoFastCandidates([]), []);
  });

  test('with no evidence anywhere the shipped order is kept', () => {
    const prior = [cand('a', null), cand('b', null), cand('c', null)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['a', 'b', 'c']);
  });

  test('below the minimum sample count a fast candidate is NOT promoted', () => {
    const prior = [cand('a', 1000), cand('b', 100, { samples: AUTO_FAST_MIN_SAMPLES - 1 })];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['a', 'b']);
  });

  test('exactly the minimum sample count is enough to be ranked', () => {
    const prior = [cand('a', 1000), cand('b', 100, { samples: AUTO_FAST_MIN_SAMPLES })];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['b', 'a']);
  });

  test('an unmeasured candidate keeps its shipped slot while measured ones re-sort around it', () => {
    const prior = [cand('slow', 1000), cand('unmeasured', null), cand('fast', 400)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['fast', 'unmeasured', 'slow']);
  });

  test('an unmeasured first candidate is never demoted behind a measured one', () => {
    const prior = [cand('unmeasured', null), cand('slow', 1000), cand('fast', 400)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['unmeasured', 'fast', 'slow']);
  });
});

describe('orderAutoFastCandidates: switch margin', () => {
  test('a clearly faster later candidate overtakes', () => {
    assert.deepEqual(names(orderAutoFastCandidates([cand('a', 1000), cand('b', 500)])), ['b', 'a']);
  });

  test('a near-tie inside the 15% margin stays in shipped order', () => {
    assert.deepEqual(names(orderAutoFastCandidates([cand('a', 1000), cand('b', 900)])), ['a', 'b']);
    assert.deepEqual(names(orderAutoFastCandidates([cand('a', 1000), cand('b', 1000)])), ['a', 'b']);
  });

  test('just past the margin overtakes (800ms * 1.15 < 1000ms)', () => {
    assert.deepEqual(names(orderAutoFastCandidates([cand('a', 1000), cand('b', 800)])), ['b', 'a']);
  });

  test('a slower later candidate stays behind', () => {
    assert.deepEqual(names(orderAutoFastCandidates([cand('a', 500), cand('b', 2000)])), ['a', 'b']);
  });

  test('three measured candidates: the fastest moves to the front, near-ties keep shipped order', () => {
    const prior = [cand('a', 1000), cand('b', 950), cand('c', 500)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['c', 'a', 'b']);
  });

  test('a fully reversed list is fully re-sorted', () => {
    const prior = [cand('slow', 3000), cand('mid', 1500), cand('fast', 500)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['fast', 'mid', 'slow']);
  });
});

describe('orderAutoFastCandidates: reliability', () => {
  test('a fast but unreliable candidate goes last', () => {
    const prior = [cand('flaky', 100, { attempts: 10, successRate: 0.5 }), cand('a', 1000), cand('b', null)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['a', 'b', 'flaky']);
  });

  test('a success rate of exactly 80% is still reliable', () => {
    const prior = [cand('a', 1000), cand('b', 100, { attempts: 10, successRate: AUTO_FAST_MIN_SUCCESS_RATE })];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['b', 'a']);
  });

  test('too few attempts cannot mark a candidate unreliable', () => {
    const prior = [cand('a', 100, { attempts: AUTO_FAST_MIN_ATTEMPTS - 1, successRate: 0 }), cand('b', 1000)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['a', 'b']);
  });

  test('exactly the minimum attempts with a poor rate is unreliable', () => {
    const prior = [cand('a', 100, { attempts: AUTO_FAST_MIN_ATTEMPTS, successRate: 0.6 }), cand('b', 1000)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['b', 'a']);
  });

  test('a null success rate is not treated as unreliable', () => {
    const prior = [cand('a', 100, { attempts: 50, successRate: null }), cand('b', 1000)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['a', 'b']);
  });

  test('an unreliable candidate with too few latency samples still goes last', () => {
    const prior = [cand('flaky', 0, { samples: 0, attempts: 6, successRate: 0 }), cand('a', null), cand('b', 700)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['a', 'b', 'flaky']);
  });

  test('several unreliable candidates keep their shipped order at the end', () => {
    const bad = { attempts: 10, successRate: 0.1 };
    const prior = [cand('x', 900, bad), cand('a', 1000), cand('y', 50, bad), cand('b', 400)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['b', 'a', 'x', 'y']);
  });

  test('all candidates unreliable: shipped order, nothing dropped', () => {
    const bad = { attempts: 10, successRate: 0 };
    const prior = [cand('x', 900, bad), cand('y', 50, bad)];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['x', 'y']);
  });
});

describe('orderAutoFastCandidates: contract', () => {
  test('returns a new array of the same objects and leaves the input untouched', () => {
    const prior = [cand('a', 1000), cand('u', null), cand('b', 300), cand('f', 10, { attempts: 9, successRate: 0.2 })];
    const snapshot = [...prior];
    const out = orderAutoFastCandidates(prior);
    assert.notEqual(out, prior);
    assert.deepEqual(prior, snapshot);
    assert.equal(out.length, prior.length);
    for (const c of prior) assert.ok(out.includes(c));
    assert.deepEqual(names(out), ['b', 'u', 'a', 'f']);
  });

  test('accepts a frozen (readonly) input', () => {
    const prior = Object.freeze([cand('a', 1000), cand('b', 300)]);
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['b', 'a']);
  });

  test('end to end: evidence built from profiles drives the order', () => {
    const fastProfile = profile({ small: bucket(300, 8, { ok: 8 }) });
    const slowProfile = profile({ small: bucket(1200, 8, { ok: 8 }) });
    const flakyProfile = profile({ small: bucket(100, 8, { ok: 2, timeout: 6 }) });
    const prior = [
      { name: 'slow', evidence: autoFastEvidence([slowProfile]) },
      { name: 'flaky', evidence: autoFastEvidence([flakyProfile]) },
      { name: 'new', evidence: autoFastEvidence([profile({ medium: bucket(50, 99, { ok: 99 }) })]) },
      { name: 'fast', evidence: autoFastEvidence([null, fastProfile]) },
    ];
    assert.deepEqual(names(orderAutoFastCandidates(prior)), ['fast', 'new', 'slow', 'flaky']);
  });
});
