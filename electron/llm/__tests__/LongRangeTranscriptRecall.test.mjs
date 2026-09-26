// electron/llm/__tests__/LongRangeTranscriptRecall.test.mjs
//
// Production-path tests for the H6 fix (Campaign 2, longsession, 2026-07-16):
// a bounded, deterministic lexical fallback that finds the earlier transcript
// turn a follow-up question paraphrases back to, when SessionMemory's
// entity-based recall has nothing (a free-text incident/story was never
// captured as a proper-noun entity). No LLM — real transcript text only, so
// zero-fabrication (R5) holds by construction: either the actual earlier turn
// is found, or nothing changes.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/LongRangeTranscriptRecall.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/longRangeTranscriptRecall.js');
const { recallLongRangeContext } = await import(pathToFileURL(modPath).href);

// Helper: build turns with explicit ms timestamps.
const turn = (role, text, timestamp) => ({ role, text, timestamp });

describe('long-range transcript recall (H6 fix)', () => {
  test('live-proven golden-trace scenario: finds the memory-leak turn for a paraphrased callback', () => {
    const durableTurns = [
      turn('interviewer', 'Hi, thanks for joining today. Can you hear me okay?', 0),
      turn('user', 'Yes, I can hear you fine, thanks.', 1000),
      turn('interviewer', 'Tell me about a time you had to debug a really difficult production issue.', 120000),
      turn('user', 'One time we had a memory leak in a long-running consumer process that took us three days to trace.', 150000),
      turn('interviewer', 'How did you eventually find the root cause?', 180000),
      turn('user', 'We used heap snapshots and eventually found an unbounded cache that never evicted old entries.', 210000),
    ];
    const latestQuestion = 'going back to the memory leak you mentioned earlier — how long did it take your team to ship the fix after finding the root cause?';
    const result = recallLongRangeContext(latestQuestion, durableTurns, 900000, 1080000);

    assert.ok(result.block, 'must find a matching earlier turn');
    assert.match(result.block, /memory leak/i);
    assert.match(result.block, /long-running consumer process/i);
    assert.equal(result.matchCount, 1);
    assert.equal(result.bestAgeSeconds, 930);
  });

  test('unrelated fresh question → no match (empty block)', () => {
    const durableTurns = [
      turn('interviewer', 'What is your experience with PostgreSQL performance tuning?', 0),
      turn('user', 'I have optimized slow queries using EXPLAIN ANALYZE and added targeted indexes.', 1000),
    ];
    const result = recallLongRangeContext(
      'why do you want to work here specifically, and what makes you a good fit for this role?',
      durableTurns,
      500,
      5000,
    );
    assert.equal(result.block, '');
    assert.equal(result.matchCount, 0);
    assert.equal(result.bestAgeSeconds, null);
  });

  test('empty durable window → no match', () => {
    const result = recallLongRangeContext('going back to what you mentioned earlier, tell me more', [], 0, 1000);
    assert.equal(result.block, '');
  });

  test('question with no substantive keywords → no match (never scans blindly)', () => {
    const durableTurns = [
      turn('interviewer', 'Tell me about a memory leak you debugged.', 0),
      turn('user', 'It was a cache eviction bug in our consumer service.', 1000),
    ];
    const result = recallLongRangeContext('okay?', durableTurns, 500, 2000);
    assert.equal(result.block, '');
  });

  test('excludes turns already in the recent/live window (no redundant duplication)', () => {
    const durableTurns = [
      turn('user', 'We had a memory leak in the checkout service last quarter.', 0),
      // This turn is AFTER the cutoff — already visible in the live window, should be excluded.
      turn('interviewer', 'Going back to the memory leak you mentioned earlier, how long did the fix take?', 500000),
    ];
    // recentWindowCutoffMs = 400000 means turns at/after 400000 are already live-visible.
    const result = recallLongRangeContext(
      'going back to the memory leak you mentioned earlier, how long did the fix take?',
      durableTurns,
      400000,
      600000,
    );
    // Only the first turn (before cutoff) is a valid candidate.
    assert.ok(result.block);
    assert.match(result.block, /checkout service/i);
  });

  test('excludes the question itself even if it appears verbatim in durable turns', () => {
    const q = 'going back to the memory leak you mentioned earlier, how long did the fix take?';
    const durableTurns = [
      turn('user', 'We had a memory leak in a background worker.', 0),
      turn('interviewer', q, 100000),
    ];
    const result = recallLongRangeContext(q, durableTurns, 90000, 200000);
    assert.ok(result.block);
    assert.doesNotMatch(result.block, /how long did the fix take/i, 'must not recall the question turn itself');
  });

  test('excludes assistant turns from candidates (never re-surfaces the model\'s own prior answer as "earlier context")', () => {
    const durableTurns = [
      turn('assistant', 'I once fixed a memory leak by tuning the garbage collector settings.', 0),
    ];
    const result = recallLongRangeContext('going back to the memory leak you mentioned earlier, what happened next?', durableTurns, 90000, 200000);
    assert.equal(result.block, '', 'assistant turns are not valid recall candidates');
  });

  test('picks the MOST RECENT matching turn when multiple candidates score equally (tie-break toward recency)', () => {
    const durableTurns = [
      turn('user', 'We had a memory leak in the checkout service.', 0),
      turn('user', 'Later we also had a memory leak in the notification service.', 500000),
    ];
    const result = recallLongRangeContext('going back to the memory leak you mentioned earlier, how long did the fix take?', durableTurns, 900000, 1000000);
    assert.match(result.block, /notification service/i, 'should prefer the more recent mention');
  });

  test('block is bounded (never blows the prompt token budget)', () => {
    const longText = 'We had a memory leak in a service. '.repeat(50);
    const durableTurns = [turn('user', longText, 0)];
    const result = recallLongRangeContext('going back to the memory leak you mentioned earlier, what happened?', durableTurns, 900000, 1000000);
    assert.ok(result.block.length <= 700, `block should be bounded, was ${result.block.length} chars`);
  });

  // Skeptic-pass regression suite (Campaign 2, 2026-07-16): the FIRST draft of
  // this fix had two real problems the skeptic pass caught before commit.
  describe('skeptic-pass fixes: comp-leak gate + anti-misattribution threshold', () => {
    test('a comp/salary figure is NEVER recalled outside negotiation mode, even with a strong keyword match', () => {
      const durableTurns = [
        turn('user', 'My base salary expectation is around 185k, and I would want that to assume some equity as well.', 60000),
        turn('interviewer', "Understood, let's move on to a coding question.", 90000),
      ];
      const q = 'going back to what you mentioned earlier about your salary expectations, does that number assume equity or just base?';
      const result = recallLongRangeContext(q, durableTurns, 500000, 700000, false);
      assert.equal(result.block, '', 'a comp figure must never leak into a non-negotiation follow-up via this fallback');
    });

    test('a comp/salary figure IS recallable when the effective mode is negotiation', () => {
      const durableTurns = [
        turn('user', 'My base salary expectation is around 185k, and I would want that to assume some equity as well.', 60000),
      ];
      const q = 'going back to what you mentioned earlier about your salary expectations, does that number assume equity or just base?';
      const result = recallLongRangeContext(q, durableTurns, 500000, 700000, true);
      assert.ok(result.block, 'negotiation mode must still be able to recall its own prior comp figure');
      assert.match(result.block, /185k/);
    });

    test('a single shared weak keyword across two UNRELATED turns does not cause a confident wrong-turn misattribution', () => {
      const durableTurns = [
        turn('user', 'We had a scaling issue with the load balancer during a traffic spike last quarter.', 0),
        turn('user', 'The checkout rewrite decision came after a long debate about database migration strategy.', 100000),
      ];
      const q = 'going back to the production incident you mentioned earlier, what was the actual root cause?';
      const result = recallLongRangeContext(q, durableTurns, 500000, 700000);
      assert.equal(result.block, '', 'a single incidental keyword match must fail safe (empty) rather than guess the wrong turn');
    });

    test('a genuine 2+ keyword match still recalls correctly (the threshold raise does not just suppress everything)', () => {
      const durableTurns = [
        turn('user', 'We had a load balancer outage that took down checkout for twenty minutes during a traffic spike.', 0),
      ];
      const q = 'you mentioned the load balancer outage earlier, can you walk me through how your team responded in the moment?';
      const result = recallLongRangeContext(q, durableTurns, 500000, 700000);
      assert.ok(result.block, 'a genuine multi-keyword match must still recall');
      assert.match(result.block, /load balancer outage/i);
    });
  });
});
