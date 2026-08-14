// node:test — Phase 2 live-wiring verification: the DURABLE long-range memory window.
//
// CONTEXT (verified bug): IntelligenceEngine.runWhatShouldISay built its long-range
// follow-up memory from `session.getContext(LIVE_MEMORY_WINDOW_SECONDS=7200)` — a "2h
// window". But SessionTracker.getContext() reads `contextItems`, which is hard-evicted
// to ~120s on EVERY final segment by `evictOldEntries()`. So the intended 2h window
// silently only ever saw the last ~2 minutes: a project named at minute 1 was already
// gone by minute 3. The fix routes that read through getDurableContext(), which reads
// the persisted `fullTranscript` (survives the 120s eviction), behind the default-OFF
// `durableMemoryWindow` flag (env NATIVELY_DURABLE_MEMORY_WINDOW).
//
// This test proves the bug and the fix at the SOURCE level against the REAL compiled
// SessionTracker (no time-mocking needed: addTranscript honors each segment's own
// timestamp, and evictOldEntries filters contextItems on Date.now()-120s — so a segment
// stamped in the real past is evicted from contextItems but retained in fullTranscript).
// It also pins the flag semantics (OFF→false, env=1→true, fresh read) and the
// ContextItem shape contract that makes the engine's `.map(item => ...)` safe across
// BOTH sources.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SessionTracker } from '../../../dist-electron/electron/SessionTracker.js';
import {
  isDurableMemoryWindowEnabled,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

const WINDOW = 7200; // IntelligenceEngine.LIVE_MEMORY_WINDOW_SECONDS (2h)
const PROJECT = 'Project Atlas';

function clearEnv() {
  delete process.env.NATIVELY_DURABLE_MEMORY_WINDOW;
  __resetIntelligenceFlagsCache();
}

// Build a SessionTracker where "Project Atlas" was mentioned ~3.3 min ago (real past
// timestamp), then add several recent interviewer turns. Because evictOldEntries() keeps
// only contextItems within the last 120s, the minute-1 mention is gone from contextItems
// but still resident in fullTranscript.
function buildAgedSession() {
  const s = new SessionTracker();
  const now = Date.now();

  // t = ~3.3 minutes ago: the long-range entity the feature exists to recall.
  s.addTranscript({
    speaker: 'interviewer',
    text: `Earlier you were the tech lead on ${PROJECT}, our data platform rewrite.`,
    timestamp: now - 200_000, // 200s ago — outside the 120s contextItems window
    final: true,
  });

  // A few RECENT turns (well within 120s) so contextItems is non-empty but only holds
  // the recent window. Distinct timestamps + texts to dodge the <500ms dedupe guard.
  s.addTranscript({ speaker: 'interviewer', text: "So let's talk about your recent work.", timestamp: now - 8_000, final: true });
  s.addTranscript({ speaker: 'user', text: 'Sure, happy to dig into it.', timestamp: now - 5_000, final: true });
  s.addTranscript({ speaker: 'interviewer', text: 'What was the hardest part of it?', timestamp: now - 1_000, final: true });

  return s;
}

describe('SessionTracker: durable vs evicted memory window (source-level)', () => {
  test('SANITY: the recent window is what getContext can see; the aged entity is not', () => {
    const s = buildAgedSession();
    const ctx = s.getContext(WINDOW);
    // contextItems holds only the 3 recent turns (the aged one was evicted).
    assert.equal(ctx.length, 3, 'getContext should hold only the un-evicted recent turns');
    assert.ok(ctx.every((i) => !i.text.includes(PROJECT)), 'recent window must not contain the aged entity');
  });

  test('REPRODUCES BUG: getContext(7200) does NOT recall the minute-1 entity', () => {
    const s = buildAgedSession();
    const recalled = s.getContext(WINDOW).some((i) => i.text.includes(PROJECT));
    assert.equal(
      recalled,
      false,
      'BUG: the OFF path (getContext) cannot see the aged entity — contextItems is evicted to 120s, so the "2h window" is a lie',
    );
  });

  test('PROVES FIX: getDurableContext(7200) DOES recall the minute-1 entity', () => {
    const s = buildAgedSession();
    const recalled = s.getDurableContext(WINDOW).some((i) => i.text.includes(PROJECT));
    assert.equal(
      recalled,
      true,
      'FIX: getDurableContext reads fullTranscript (survives eviction), so the long-range entity is still present at minute 62',
    );
  });

  test('SHAPE CONTRACT: getDurableContext returns the same {role,text,timestamp} ContextItem shape as getContext', () => {
    const s = buildAgedSession();
    // Both must produce items the engine can .map(item => ({ role, text, t: floor(ts/1000) })).
    for (const [label, items] of [['getContext', s.getContext(WINDOW)], ['getDurableContext', s.getDurableContext(WINDOW)]]) {
      assert.ok(items.length > 0, `${label} returned no items`);
      for (const item of items) {
        assert.equal(typeof item.role, 'string', `${label}: role must be a string`);
        assert.ok(['interviewer', 'user', 'assistant'].includes(item.role), `${label}: role must be a valid ContextItem role, got ${item.role}`);
        assert.equal(typeof item.text, 'string', `${label}: text must be a string`);
        assert.equal(typeof item.timestamp, 'number', `${label}: timestamp must be a number (ms)`);
        // The engine does Math.floor(item.timestamp / 1000) — must be finite.
        assert.ok(Number.isFinite(Math.floor(item.timestamp / 1000)), `${label}: timestamp must be finite for ms→s conversion`);
      }
    }
  });

  test('the durable window honors its lastSeconds cutoff (not unbounded by default)', () => {
    const s = new SessionTracker();
    const now = Date.now();
    // One entity inside a 60s window, one well outside it.
    s.addTranscript({ speaker: 'interviewer', text: 'RECENT topic alpha', timestamp: now - 10_000, final: true });
    s.addTranscript({ speaker: 'interviewer', text: 'ANCIENT topic omega', timestamp: now - 3_600_000, final: true }); // 1h ago

    const narrow = s.getDurableContext(60); // 60s window
    assert.ok(narrow.some((i) => i.text.includes('alpha')), 'recent durable item should be inside a 60s window');
    assert.ok(!narrow.some((i) => i.text.includes('omega')), 'a 1h-old item must be OUTSIDE a 60s durable window');

    const wide = s.getDurableContext(WINDOW); // 2h window
    assert.ok(wide.some((i) => i.text.includes('alpha')) && wide.some((i) => i.text.includes('omega')), 'both items are inside a 2h window');
  });

  test('durable window mirrors getContext exactly when nothing has been evicted (no divergence on short sessions)', () => {
    // If a session is entirely within 120s, the OFF path and the durable path must agree —
    // proves the durable read is a strict superset that only adds back the evicted tail.
    const s = new SessionTracker();
    const now = Date.now();
    s.addTranscript({ speaker: 'interviewer', text: 'q one about scaling', timestamp: now - 30_000, final: true });
    s.addTranscript({ speaker: 'user', text: 'answer one regarding sharding', timestamp: now - 20_000, final: true });
    s.addTranscript({ speaker: 'interviewer', text: 'q two about caching', timestamp: now - 10_000, final: true });

    const ctxTexts = s.getContext(WINDOW).map((i) => `${i.role}:${i.text}`);
    const durTexts = s.getDurableContext(WINDOW).map((i) => `${i.role}:${i.text}`);
    assert.deepEqual(durTexts, ctxTexts, 'within the 120s window the durable read must equal getContext (same role/text/order)');
  });
});

describe('durableMemoryWindow flag: flips the source, defaults OFF, fresh read', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('defaults OFF (current getContext path preserved until opted in)', () => {
    assert.equal(isDurableMemoryWindowEnabled(), false);
  });

  test('NATIVELY_DURABLE_MEMORY_WINDOW=1 enables it (fresh env read, no cache)', () => {
    process.env.NATIVELY_DURABLE_MEMORY_WINDOW = '1';
    assert.equal(isDurableMemoryWindowEnabled(), true, 'env=1 must enable the durable window');
    delete process.env.NATIVELY_DURABLE_MEMORY_WINDOW;
    assert.equal(isDurableMemoryWindowEnabled(), false, 'removing the env var must flip back OFF without any cache reset');
  });

  test('END-TO-END (source-level): the flag genuinely selects which method the engine ternary would call', () => {
    // The engine line is exactly:
    //   isDurableMemoryWindowEnabled() ? session.getDurableContext(W) : session.getContext(W)
    // We reproduce that ternary against the real tracker and assert the recall outcome
    // flips with the flag — this + the one-line engine ternary = end-to-end proof.
    const s = buildAgedSession();
    const pickSource = () =>
      isDurableMemoryWindowEnabled() ? s.getDurableContext(WINDOW) : s.getContext(WINDOW);

    // Flag OFF → getContext → entity NOT recalled (today's behavior).
    assert.equal(pickSource().some((i) => i.text.includes(PROJECT)), false, 'flag OFF must reproduce the bug (no long-range recall)');

    // Flag ON → getDurableContext → entity recalled (the fix).
    process.env.NATIVELY_DURABLE_MEMORY_WINDOW = '1';
    assert.equal(pickSource().some((i) => i.text.includes(PROJECT)), true, 'flag ON must recall the long-range entity');
  });
});
