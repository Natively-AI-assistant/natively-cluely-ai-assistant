// PHASE 12 — In-Meeting Search V2: local-first lexical/fuzzy, timestamps, latency.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SearchOrchestrator } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

const svc = new SearchOrchestrator();

const CHUNKS = [
  { text: 'Let us talk about the pricing for the enterprise tier.', timestampMs: 1000, speaker: 'them' },
  { text: 'The timeline for delivery is six weeks.', timestampMs: 2000, speaker: 'me' },
  { text: 'We should use Redis for caching the hot path.', timestampMs: 3000, speaker: 'me' },
  { text: 'Pricing is flexible for annual commitments.', timestampMs: 4000, speaker: 'them' },
];

describe('InMeetingSearch — local lexical', () => {
  test('finds chunks matching the query, ranked by relevance', () => {
    const res = svc.inMeetingSearch(CHUNKS, 'pricing');
    assert.ok(res.length >= 2);
    assert.ok(res.every(r => /pricing/i.test(r.snippet)));
  });

  test('returns timestamps for jump-to-segment', () => {
    const res = svc.inMeetingSearch(CHUNKS, 'redis');
    assert.equal(res.length, 1);
    assert.equal(res[0].timestampMs, 3000);
    assert.equal(res[0].speaker, 'me');
  });

  test('phrase match scores higher than scattered terms', () => {
    const res = svc.inMeetingSearch([
      { text: 'enterprise pricing tier details', timestampMs: 1 },
      { text: 'pricing was discussed and the enterprise plan too', timestampMs: 2 },
    ], 'enterprise pricing');
    assert.equal(res[0].timestampMs, 1, 'contiguous phrase ranks first');
  });

  test('empty query / no match → empty, never throws', () => {
    assert.deepEqual(svc.inMeetingSearch(CHUNKS, ''), []);
    assert.deepEqual(svc.inMeetingSearch(CHUNKS, 'zzzznotfound'), []);
    assert.doesNotThrow(() => svc.inMeetingSearch([], 'x'));
  });
});

describe('InMeetingSearch — latency budget (<150ms lexical)', () => {
  test('1000-chunk search well under the 150ms budget', () => {
    const big = [];
    for (let i = 0; i < 1000; i++) big.push({ text: `Turn ${i} about pricing timelines and Redis caching strategies.`, timestampMs: i });
    const times = [];
    for (let i = 0; i < 7; i++) {
      const t0 = process.hrtime.bigint();
      svc.inMeetingSearch(big, 'redis caching');
      const t1 = process.hrtime.bigint();
      times.push(Number(t1 - t0) / 1e6);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    assert.ok(median < 150, `in-meeting search median ${median.toFixed(2)}ms exceeded 150ms budget`);
  });
});
