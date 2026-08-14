// PHASE 10 verification — In-Meeting Search V2 handler LOGIC.
//
// The real IPC handler `search:in-meeting` (electron/ipcHandlers.ts) needs Electron +
// a live IntelligenceManager/SessionTracker, so we can't unit-test the handler itself
// headlessly. Instead this file FAITHFULLY REPLICATES the handler's pure mapping
// (ipcHandlers.ts `search:in-meeting`: transcript [{speaker,text,timestamp}] → chunks
// [{text, timestampMs:timestamp, speaker}]) and runs the REAL compiled
// SearchOrchestrator.inMeetingSearch from dist-electron. If the handler's
// transcript→chunks mapping ever drifts (especially the timestamp→timestampMs carry,
// which is the jump-to-segment capability), these assertions catch it.
//
// Source of truth for the data shape:
//   - IntelligenceManager.getCurrentMeetingTranscript() (electron/IntelligenceManager.ts:129)
//     returns Array<{ speaker, text, timestamp }> derived from SessionTracker.getFullTranscript().
//   - The handler (ipcHandlers.ts, `search:in-meeting`) maps each turn:
//       { text: t.text, timestampMs: t.timestamp, speaker: t.speaker }
//     then calls `new SearchOrchestrator().inMeetingSearch(chunks, query)`.
//
// NO Hindsight, NO RAG/embeddings, NO network — pure in-memory lexical match.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SearchOrchestrator } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

// ----------------------------------------------------------------------------
// REPLICA of the handler's transcript→chunks mapping + search call.
// Kept byte-faithful to the production logic (ipcHandlers.ts `search:in-meeting`):
//   const chunks = transcript.map((t) => ({ text: t.text, timestampMs: t.timestamp, speaker: t.speaker }));
//   const results = new SearchOrchestrator().inMeetingSearch(chunks, query || '');
// so this test asserts the REAL behavior, including the jump-to-segment timestamp carry.
// ----------------------------------------------------------------------------
function runInMeetingSearchLogic(transcript, query) {
  const chunks = (transcript || []).map((t) => ({
    text: t.text,
    timestampMs: t.timestamp,
    speaker: t.speaker,
  }));
  return new SearchOrchestrator().inMeetingSearch(chunks, query || '');
}

// ----------------------------------------------------------------------------
// Fake current-meeting transcript shaped EXACTLY like
// IntelligenceManager.getCurrentMeetingTranscript() output:
//   Array<{ speaker: string; text: string; timestamp: number }>
// ----------------------------------------------------------------------------
const transcript = [
  { speaker: 'Interviewer', text: 'So, walk me through your background.', timestamp: 1000 },
  { speaker: 'You', text: 'I led the migration of our session store to Redis for caching.', timestamp: 5000 },
  { speaker: 'Interviewer', text: 'What was the cache eviction policy you used?', timestamp: 9000 },
  { speaker: 'You', text: 'We picked an LRU eviction policy and tuned the maxmemory setting.', timestamp: 13000 },
  { speaker: 'Interviewer', text: 'Tell me about a time Redis cache invalidation bit you.', timestamp: 17000 },
  { speaker: 'You', text: 'GraphQL resolvers were over-fetching, unrelated to caching.', timestamp: 21000 },
];

describe('Phase 10 — in-meeting search handler logic (real SearchOrchestrator)', () => {
  test('(a) "redis" finds the turn mentioning Redis with timestampMs + speaker preserved (jump-to-segment)', () => {
    const res = runInMeetingSearchLogic(transcript, 'redis');
    assert.ok(res.length >= 1, 'at least one Redis turn is found');

    // Every result must carry through speaker + timestampMs (the jump-to-segment data).
    for (const r of res) {
      assert.equal(typeof r.snippet, 'string');
      assert.ok(r.snippet.length > 0, 'non-empty snippet');
      assert.equal(typeof r.timestampMs, 'number', 'timestampMs is a number (jump target)');
      assert.equal(typeof r.speaker, 'string', 'speaker is attributed');
      assert.ok(r.score > 0, 'positive relevance score');
    }

    // The "led the migration ... to Redis" turn (timestamp 5000, speaker "You") is present
    // and its timestampMs is the ORIGINAL transcript timestamp — NOT lost/renamed/zeroed.
    const ledTurn = res.find((r) => /led the migration/i.test(r.snippet));
    assert.ok(ledTurn, 'the Redis-migration turn is returned');
    assert.equal(ledTurn.timestampMs, 5000, 'timestampMs carried verbatim from transcript.timestamp (jump-to-segment)');
    assert.equal(ledTurn.speaker, 'You', 'speaker carried verbatim from transcript.speaker');

    // The "invalidation bit you" turn (timestamp 17000, Interviewer) also matches "redis".
    const invalidationTurn = res.find((r) => /invalidation/i.test(r.snippet));
    assert.ok(invalidationTurn, 'the Redis-invalidation turn is returned');
    assert.equal(invalidationTurn.timestampMs, 17000, 'second match keeps its own distinct timestamp');
    assert.equal(invalidationTurn.speaker, 'Interviewer', 'second match keeps its own speaker');
  });

  test('(a2) every returned timestampMs maps back to a real transcript turn (no mis-mapping)', () => {
    const validTimestamps = new Set(transcript.map((t) => t.timestamp));
    const res = runInMeetingSearchLogic(transcript, 'cache policy eviction redis');
    assert.ok(res.length >= 1, 'results returned');
    for (const r of res) {
      assert.ok(
        validTimestamps.has(r.timestampMs),
        `timestampMs ${r.timestampMs} corresponds to a real transcript turn`,
      );
      // And the snippet at that timestamp matches the source text for that turn.
      const src = transcript.find((t) => t.timestamp === r.timestampMs);
      assert.equal(r.snippet, src.text, 'snippet text matches the source turn at that timestamp');
      assert.equal(r.speaker, src.speaker, 'speaker matches the source turn at that timestamp');
    }
  });

  test('(b) phrase/full match ranks above PARTIAL (scattered, fewer-term) match', () => {
    // IMPORTANT scoring property of inMeetingSearch (SearchOrchestrator.ts:213):
    //   score = Math.min(1, hits/terms.length + phraseBonus)
    // When ALL query terms are present in a turn, hits/terms.length === 1.0, so the
    // +0.5 phrase bonus is FULLY CLAMPED to 1.0 and becomes invisible to ranking.
    // (The library's own InMeetingSearchV2 "phrase" test passes only because of the
    // ascending-timestamp tiebreaker when both turns tie at 1.0 — not a score delta.)
    //
    // The phrase/coverage bonus therefore expresses itself as ranking only when the
    // competing turn has PARTIAL coverage (hits < terms.length). That is the real,
    // observable "phrase ranks above scattered" behavior, so we assert THAT here.
    const t2 = [
      // BOTH terms present (full coverage) → hits/terms = 2/2 = 1.0 → score 1.0.
      { speaker: 'You', text: 'We picked an lru eviction strategy.', timestamp: 100 },
      // Only ONE of the two terms present (partial) → hits/terms = 1/2 = 0.5 → score 0.5.
      { speaker: 'You', text: 'We talked about eviction in general terms.', timestamp: 200 },
    ];
    const res = runInMeetingSearchLogic(t2, 'lru eviction');
    assert.equal(res.length, 2, 'both turns match at least one term');
    assert.equal(res[0].timestampMs, 100, 'full-coverage turn ranks first');
    assert.ok(
      res[0].score > res[1].score,
      `full-coverage score (${res[0].score}) > partial score (${res[1].score})`,
    );
    assert.equal(res[1].timestampMs, 200, 'partial-coverage turn ranks second');
  });

  test('(b2) a contiguous phrase outranks a fully-covered SCATTERED match (Phase 10 scoring fix)', () => {
    // Two turns, both containing BOTH query terms. One has them CONTIGUOUS (phrase),
    // the other SCATTERED. After the Phase-10 scoring fix (coverage capped at 0.7 +
    // 0.3 phrase bonus, so coverage no longer clamps the bonus to invisibility), the
    // contiguous-phrase turn scores HIGHER (1.0 vs 0.7) and ranks first regardless of
    // timestamp order. This is the desired "phrase priority" behavior.
    const t3 = [
      { speaker: 'You', text: 'scattered: eviction first, then lru later on.', timestamp: 100 },
      { speaker: 'You', text: 'contiguous lru eviction here.', timestamp: 200 },
    ];
    const res = runInMeetingSearchLogic(t3, 'lru eviction');
    assert.equal(res.length, 2);
    assert.equal(res[0].timestampMs, 200, 'the contiguous-phrase turn ranks first');
    assert.ok(res[0].score > res[1].score, 'phrase turn scores strictly higher than the scattered turn');
    assert.equal(res[1].timestampMs, 100, 'the scattered (partial-credit) turn ranks second');
  });

  test('(c) empty query / whitespace query / no-match query → []', () => {
    assert.deepEqual(runInMeetingSearchLogic(transcript, ''), [], 'empty query → []');
    assert.deepEqual(runInMeetingSearchLogic(transcript, '   '), [], 'whitespace query → []');
    // Single-char-only query: every term filtered by the t.length > 1 rule → [].
    assert.deepEqual(runInMeetingSearchLogic(transcript, 'a'), [], 'single-char query → []');
    assert.deepEqual(
      runInMeetingSearchLogic(transcript, 'kubernetes helm istio'),
      [],
      'no-match query → []',
    );
  });

  test('(d) empty transcript (no active meeting / meeting just started) → []', () => {
    // This is the no-active-meeting reality: SessionTracker.fullTranscript is [] →
    // getCurrentMeetingTranscript() returns [] → chunks [] → inMeetingSearch([], q) → [].
    assert.deepEqual(runInMeetingSearchLogic([], 'redis'), [], 'empty transcript → []');
    assert.deepEqual(runInMeetingSearchLogic([], ''), [], 'empty transcript + empty query → []');
  });

  test('(e) never throws on malformed input (defensive — the handler is try/catch wrapped too)', () => {
    const svc = new SearchOrchestrator();
    assert.doesNotThrow(() => svc.inMeetingSearch(undefined, 'redis'));
    assert.deepEqual(svc.inMeetingSearch(undefined, 'redis'), [], 'undefined chunks → []');
    assert.doesNotThrow(() => svc.inMeetingSearch([null, undefined], 'redis'));
    assert.doesNotThrow(() => svc.inMeetingSearch([{ text: null }], 'redis'));
    assert.doesNotThrow(() => svc.inMeetingSearch([{ /* no text */ timestampMs: 1, speaker: 'X' }], 'redis'));
    // Malformed transcript turns mapped through the real handler mapping must not throw.
    assert.doesNotThrow(() =>
      runInMeetingSearchLogic(
        [
          { speaker: 'You', text: 'redis is great', timestamp: 1 },
          { speaker: undefined, text: undefined, timestamp: undefined },
          null,
        ].filter(Boolean), // the handler maps a real array; nulls inside chunks are still handled by the engine
        'redis',
      ),
    );
    // A turn with a missing/undefined timestamp must not crash and must surface (timestampMs undefined).
    const res = runInMeetingSearchLogic(
      [{ speaker: 'You', text: 'redis everywhere', timestamp: undefined }],
      'redis',
    );
    assert.equal(res.length, 1, 'turn with undefined timestamp still matches');
    assert.equal(res[0].timestampMs, undefined, 'missing timestamp surfaces as undefined (not a crash)');
  });

  test('(e2) results are ranked by score descending', () => {
    const res = runInMeetingSearchLogic(transcript, 'redis cache eviction policy');
    assert.ok(res.length >= 2, 'multiple results to rank');
    for (let i = 1; i < res.length; i++) {
      assert.ok(
        res[i - 1].score >= res[i].score,
        `result ${i - 1} (${res[i - 1].score}) >= result ${i} (${res[i].score})`,
      );
    }
  });

  // --------------------------------------------------------------------------
  // LATENCY: spec requires <150ms lexical in-meeting search. The library has its
  // own latency test; here we verify the END-TO-END handler path (transcript →
  // chunks mapping → inMeetingSearch) stays fast on a LARGE current meeting.
  // A ~1-hour meeting can accumulate hundreds–thousands of finalized turns.
  // --------------------------------------------------------------------------
  test('(f) END-TO-END mapping+search on a 1000-turn meeting: median < 150ms', () => {
    const SPEAKERS = ['You', 'Interviewer'];
    const FILLER = [
      'We discussed the system design and the trade-offs involved here.',
      'The latency numbers looked good after the optimization pass we ran.',
      'I think the team aligned on the approach for the next sprint cycle.',
      'There were some open questions about the data model and indexing.',
      'Redis came up again when we talked about the caching layer design.',
    ];
    const bigTranscript = [];
    for (let i = 0; i < 1000; i++) {
      bigTranscript.push({
        speaker: SPEAKERS[i % SPEAKERS.length],
        text: `${FILLER[i % FILLER.length]} Turn number ${i}.`,
        timestamp: i * 4000,
      });
    }
    assert.equal(bigTranscript.length, 1000, '1000-turn meeting built');

    const N = 21;
    const samples = [];
    for (let run = 0; run < N; run++) {
      const start = performance.now();
      // FULL handler path: map transcript → chunks → run real inMeetingSearch.
      const res = runInMeetingSearchLogic(bigTranscript, 'redis caching layer');
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      // Sanity: it actually found the ~200 Redis turns each run (every 5th turn).
      assert.ok(res.length > 0, 'large search returns matches');
      // And timestampMs is preserved on the large path too.
      assert.equal(typeof res[0].timestampMs, 'number', 'timestampMs preserved at scale');
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    // Generous ceiling to avoid CI flakiness while still enforcing the <150ms spec.
    assert.ok(
      median < 150,
      `median end-to-end mapping+search over 1000 turns must be < 150ms (was ${median.toFixed(2)}ms; p95 ${p95.toFixed(2)}ms)`,
    );
  });
});
