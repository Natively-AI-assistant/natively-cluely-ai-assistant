// PHASE 11 — Global Search V2: fusion ranking, filters, user/org isolation, dedupe.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SearchOrchestrator, SEARCH_FUSION_WEIGHTS } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

const svc = new SearchOrchestrator();

function cand(over) {
  return { meetingId: 'm', title: 'T', date: 1e13, mode: 'sales', snippet: 's', source: 'lexical', score: 0.5, userId: 'alice', ...over };
}

describe('GlobalSearch — fusion ranking', () => {
  test('weights match the spec (0.30/0.30/0.20/0.10/0.10, sum 1)', () => {
    assert.equal(SEARCH_FUSION_WEIGHTS.lexical, 0.30);
    assert.equal(SEARCH_FUSION_WEIGHTS.vector, 0.30);
    assert.equal(SEARCH_FUSION_WEIGHTS.memory, 0.20);
    assert.equal(SEARCH_FUSION_WEIGHTS.recency, 0.10);
    assert.equal(SEARCH_FUSION_WEIGHTS.metadata, 0.10);
    const sum = Object.values(SEARCH_FUSION_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  test('fuses sources per meeting and ranks by confidence', () => {
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical', score: 1.0 }),
      cand({ meetingId: 'm1', source: 'vector', score: 1.0 }),
      cand({ meetingId: 'm2', source: 'lexical', score: 0.4 }),
    ], { userId: 'alice' }, {}, 1e13);
    assert.equal(res[0].meetingId, 'm1', 'multi-source meeting ranks first');
    assert.ok(res[0].confidence > res[1].confidence);
    assert.ok(res[0].sourceTypes.includes('lexical') && res[0].sourceTypes.includes('vector'));
  });

  test('dedupes by meetingId (one result per meeting)', () => {
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', source: 'lexical' }),
      cand({ meetingId: 'm1', source: 'vector' }),
      cand({ meetingId: 'm1', source: 'memory' }),
    ], { userId: 'alice' });
    assert.equal(res.length, 1);
  });

  test('whyMatched explains the match', () => {
    const res = svc.globalSearch([cand({ meetingId: 'm1', source: 'lexical', score: 1 })], { userId: 'alice' });
    assert.match(res[0].whyMatched, /exact text match/);
  });
});

describe('GlobalSearch — ISOLATION (no cross-user/org leakage)', () => {
  test('Bob never sees Alice\'s meetings', () => {
    const res = svc.globalSearch([
      cand({ meetingId: 'alice-mtg', userId: 'alice', snippet: "Alice's secret project" }),
      cand({ meetingId: 'bob-mtg', userId: 'bob', snippet: "Bob's meeting" }),
    ], { userId: 'bob' });
    assert.equal(res.length, 1);
    assert.equal(res[0].meetingId, 'bob-mtg');
    assert.doesNotMatch(JSON.stringify(res), /Alice's secret/);
  });

  test('org scoping drops cross-org candidates', () => {
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', userId: 'alice', orgId: 'acme' }),
      cand({ meetingId: 'm2', userId: 'alice', orgId: 'other' }),
    ], { userId: 'alice', orgId: 'acme' });
    assert.equal(res.length, 1);
    assert.equal(res[0].meetingId, 'm1');
  });

  test('a memory-sourced foreign result is filtered BEFORE ranking', () => {
    // Simulates a Hindsight recall that returned another user's memory — must be dropped.
    const res = svc.globalSearch([
      cand({ meetingId: 'leak', userId: 'mallory', source: 'memory', score: 1.0 }),
    ], { userId: 'alice' });
    assert.equal(res.length, 0);
  });
});

describe('GlobalSearch — filters', () => {
  test('mode + date filters apply', () => {
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', mode: 'sales', date: 1e13 }),
      cand({ meetingId: 'm2', mode: 'technical-interview', date: 1e13 }),
    ], { userId: 'alice' }, { mode: 'sales' });
    assert.equal(res.length, 1);
    assert.equal(res[0].meetingId, 'm1');
  });

  test('company metadata filter applies', () => {
    const res = svc.globalSearch([
      cand({ meetingId: 'm1', metadata: { company: 'Acme Corp' } }),
      cand({ meetingId: 'm2', metadata: { company: 'Globex' } }),
    ], { userId: 'alice' }, { company: 'acme' });
    assert.equal(res.length, 1);
    assert.equal(res[0].meetingId, 'm1');
  });

  test('never throws on empty input', () => {
    assert.doesNotThrow(() => svc.globalSearch([], { userId: 'alice' }));
    assert.deepEqual(svc.globalSearch([], { userId: 'alice' }), []);
  });
});
