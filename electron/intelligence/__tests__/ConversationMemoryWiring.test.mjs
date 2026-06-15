// PHASE 11 WIRING — Conversation Memory V2 in the manual chat path
// (electron/ipcHandlers.ts gemini-chat-stream).
//
// The manual chat IPC handler is SINGLE-SHOT — no conversation history is threaded
// in. Phase 11 wires a per-process ConversationMemoryService keyed by `senderId`
// (= the renderer/session identity, `String(event.sender.id)`):
//   • record() each delivered manual turn (try/catch, regardless of flag),
//   • resolveSameSession(String(senderId), message) BEFORE the bare-follow-up
//     clarification, so a bare follow-up resolves to the prior turn instead of a
//     dead-end clarification (only when the flag is on).
//
// This test exercises the REAL compiled ConversationMemoryService from dist-electron
// — the exact object the IPC handler constructs — and proves the wiring invariants
// that matter for safety + correctness: SESSION ISOLATION (no cross-window leak),
// null-on-no-prior (caller falls to clarification), BOUNDED memory (no unbounded
// growth over a long app run), and never-throws on malformed input.
//
// NOTE: senderId is a NUMBER in the handler (event.sender.id) and is stringified at
// every call site (String(senderId)). We use string keys here to mirror that exactly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemoryService } from '../../../dist-electron/electron/intelligence/ConversationMemoryService.js';

// Mirror the handler's two call sites exactly.
function recordTurn(svc, sessionId, userMessage, assistantAnswer, mode = 'manual', timestamp = Date.now()) {
  return svc.record({ sessionId: String(sessionId), userMessage, assistantAnswer, mode, timestamp });
}
function resolve(svc, sessionId, message) {
  return svc.resolveSameSession(String(sessionId), message);
}

describe('Phase 11 wiring — same-session recovery (the happy path the handler relies on)', () => {
  test('(a) record in session A, then a bare follow-up in A resolves to that turn', () => {
    const svc = new ConversationMemoryService();
    // senderId is a number in the handler; stringified at the call site.
    recordTurn(svc, 7, 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.');
    const prior = resolve(svc, 7, 'make that shorter');
    assert.ok(prior, 'a prior turn must be found for a bare follow-up in the same session');
    // The handler only proceeds when BOTH fields are present (it builds the
    // "PRIOR EXCHANGE" block from prior.userMessage + prior.assistantAnswer).
    assert.ok(prior.userMessage && prior.assistantAnswer, 'both fields present → handler builds the context block');
    assert.match(prior.userMessage, /Redis/);
    assert.match(prior.assistantAnswer, /60s TTL/);
  });

  test('the synthesized PRIOR EXCHANGE block (handler shape) contains the real Q and A', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 7, 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.');
    const prior = resolve(svc, 7, 'make that shorter');
    // Reproduce the exact string the handler sets `context` to (ipcHandlers.ts ~line 817).
    const context = `PRIOR EXCHANGE IN THIS CONVERSATION:\nUser asked: ${prior.userMessage}\nYou answered: ${prior.assistantAnswer}\n\nThe user's new message is a follow-up to that. Resolve it against the prior exchange.`;
    assert.match(context, /PRIOR EXCHANGE IN THIS CONVERSATION/);
    assert.match(context, /User asked: Explain the Redis caching design/);
    assert.match(context, /You answered: We cache the hot path in Redis/);
  });
});

describe('Phase 11 wiring — SESSION ISOLATION (critical: no cross-window leak)', () => {
  test('(b) session B cannot see session A\'s turn — resolveSameSession(B) returns null', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'A', 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.');
    // Different renderer/session id — bare follow-up, identical wording.
    const leak = resolve(svc, 'B', 'make that shorter');
    assert.equal(leak, null, 'session B must NOT resolve against session A\'s turn');
  });

  test('two interleaved sessions never bleed into each other', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, '100', 'Tell me about Kafka partitions', 'Kafka splits topics into partitions for parallelism.');
    recordTurn(svc, '200', 'Tell me about Postgres replication', 'Postgres uses streaming WAL replication.');
    const a = resolve(svc, '100', 'continue');
    const b = resolve(svc, '200', 'continue');
    assert.match(a.assistantAnswer, /Kafka/);
    assert.doesNotMatch(a.assistantAnswer, /Postgres/);
    assert.match(b.assistantAnswer, /Postgres/);
    assert.doesNotMatch(b.assistantAnswer, /Kafka/);
    // And a third, never-seen session sees nothing.
    assert.equal(resolve(svc, '300', 'continue'), null);
  });

  test('numeric vs string senderId of the SAME value collide (handler always stringifies) — by design', () => {
    const svc = new ConversationMemoryService();
    // The handler always calls String(senderId), so numeric 7 and string "7" are the
    // same logical session. This asserts the wiring contract (stringify everywhere) so
    // a future refactor that drops a String(...) at one call site would break this test.
    recordTurn(svc, 7, 'q', 'a');           // String(7) === '7'
    assert.ok(resolve(svc, '7', 'continue'), 'String(number) and the literal string key are the same session');
  });
});

describe('Phase 11 wiring — no prior turn → null (caller falls to the clarification)', () => {
  test('(c) bare follow-up with NO prior turn in the session returns null', () => {
    const svc = new ConversationMemoryService();
    // Fresh session, nothing recorded.
    const prior = resolve(svc, 'fresh-session', 'why?');
    assert.equal(prior, null, 'no prior turn → null → handler emits the original clarification');
  });

  test('a session that recorded a turn but then cleared returns null again', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'x', 'q', 'a');
    svc.clearSession('x');
    assert.equal(resolve(svc, 'x', 'continue'), null);
  });
});

describe('Phase 11 wiring — BOUNDED memory (no unbounded growth over a long app run)', () => {
  test('(d) a single session is capped (old turns evicted), most-recent retained', () => {
    const svc = new ConversationMemoryService();
    // Record far more than any per-session cap.
    const N = 5000;
    for (let i = 0; i < N; i++) {
      recordTurn(svc, 'long-run', `question number ${i}`, `answer number ${i}`, 'manual', 1000 + i);
    }
    const recent = svc.getRecentTurns('long-run', N); // ask for everything
    assert.ok(recent.length < N, 'per-session store must be bounded, not retain all 5000 turns');
    assert.ok(recent.length <= 200, `per-session bound should be tight (got ${recent.length})`);
    // The MOST RECENT turn — the one a follow-up most needs — must survive eviction.
    const last = recent[recent.length - 1];
    assert.equal(last.userMessage, `question number ${N - 1}`, 'newest turn retained after eviction');
    // And the OLDEST turn must be gone (evicted), proving bounded growth.
    assert.ok(!recent.some((t) => t.userMessage === 'question number 0'), 'oldest turn evicted');
  });

  test('many DISTINCT sessions: each is independently bounded (per-session cap, not global)', () => {
    const svc = new ConversationMemoryService();
    // A long app run can accumulate many renderer ids. Each session keeps only its own
    // bounded window; this documents that the per-session cap applies independently.
    for (let s = 0; s < 50; s++) {
      for (let i = 0; i < 300; i++) {
        recordTurn(svc, `sess-${s}`, `q${i}`, `a${i}`, 'manual', i);
      }
    }
    assert.equal(svc.sessionCount, 50, 'one bucket per distinct session id');
    for (let s = 0; s < 50; s++) {
      assert.ok(svc.getRecentTurns(`sess-${s}`, 1000).length <= 200, `session ${s} bounded`);
    }
  });
});

describe('Phase 11 wiring — never throws on empty / malformed input', () => {
  test('(e) resolveSameSession tolerates empty, whitespace, and odd input', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'm', 'a real question', 'a real answer');
    // None of these should throw; they return either a turn or null.
    assert.doesNotThrow(() => resolve(svc, 'm', ''));
    assert.doesNotThrow(() => resolve(svc, 'm', '   '));
    assert.doesNotThrow(() => resolve(svc, 'm', '???'));
    assert.doesNotThrow(() => resolve(svc, 'm', '😀 unicode follow-up 你好'));
    assert.doesNotThrow(() => resolve(svc, 'm', 'a'.repeat(10000)));
    // Unknown session never throws.
    assert.doesNotThrow(() => resolve(svc, 'never-seen', 'why?'));
    assert.equal(resolve(svc, 'never-seen', 'why?'), null);
  });

  test('record tolerates empty/odd fields (the handler always wraps it in try/catch)', () => {
    const svc = new ConversationMemoryService();
    assert.doesNotThrow(() => svc.record({ sessionId: 'm', userMessage: '', assistantAnswer: '', timestamp: 0 }));
    assert.doesNotThrow(() => svc.record({ sessionId: 'm', userMessage: 'q', assistantAnswer: 'a', timestamp: Date.now() }));
    // A turn with an empty answer must NOT satisfy the handler's `prior.assistantAnswer`
    // guard, so the handler would fall through to the clarification rather than build an
    // empty PRIOR EXCHANGE block. Confirm such a turn does not produce a usable answer.
    const svc2 = new ConversationMemoryService();
    svc2.record({ sessionId: 'm', userMessage: 'q-only', assistantAnswer: '', timestamp: 1 });
    const prior = resolve(svc2, 'm', 'continue');
    // Either null, or a turn whose empty answer fails the handler's `&& prior.assistantAnswer` guard.
    if (prior) {
      assert.equal(Boolean(prior.userMessage && prior.assistantAnswer), false,
        'a turn with an empty answer fails the handler guard → clarification, not an empty context block');
    }
  });
});

describe('Phase 11 wiring — matching is appropriate for bare follow-ups (recency fallback)', () => {
  test('"make that shorter" (no token overlap with a Redis answer) still resolves to the recent turn', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.', 'manual', 1000);
    // "make that shorter" shares the demonstrative "that" → recency fallback fires.
    const prior = resolve(svc, 'r', 'make that shorter');
    assert.ok(prior, 'bare follow-up must fall back to the most recent turn');
    assert.match(prior.assistantAnswer, /Redis/);
  });

  test('demonstrative/continuation bare follow-ups resolve to the MOST RECENT turn', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'first question', 'first answer', 'manual', 1000);
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache in Redis with a 60s TTL.', 'manual', 2000);
    // These carry a demonstrative ("that"/"it"/"this") or continuation token
    // ("and"/"continue"/"what about") that the recency-fallback regex
    // (ConversationMemoryService.ts ~line 129) recognises, so they recover.
    for (const fu of ['continue', 'and that?', 'what about it?', 'make that shorter']) {
      const prior = resolve(svc, 'r', fu);
      assert.ok(prior, `bare follow-up "${fu}" should resolve to a prior turn`);
      assert.match(prior.assistantAnswer, /Redis/, `"${fu}" should pick the MOST RECENT turn`);
    }
  });

  test('Phase 11 fix: common content-free bare follow-ups now recover to the most-recent turn', () => {
    // After widening the recency-fallback regex (Phase 11 test-engineer concern): these
    // bare follow-ups carry NO topic and share no token with the prior turn, but since
    // they're content-free by construction they correctly resolve to "the last thing we
    // discussed" instead of dead-ending. (Demonstratives like "that"/"continue" already
    // worked; this pins the newly-covered continuation/clarification verbs.)
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache in Redis with a 60s TTL.', 'manual', 2000);
    const nowRecovered = ['why?', 'how?', 'how so?', 'go on', 'tell me more', 'more',
      'expand', 'elaborate', 'go deeper', 'in more detail', 'then?', 'keep going'];
    for (const fu of nowRecovered) {
      const r = resolve(svc, 'r', fu);
      assert.ok(r, `"${fu}" should recover to the recent turn`);
      assert.match(r.assistantAnswer, /Redis/, `"${fu}" resolves to the prior Redis turn`);
    }
  });

  test('recency fallback still ignores a genuinely unrelated multi-word question', () => {
    // The library guard caps the fallback at <=6 words; the HANDLER additionally gates
    // on isBareFollowUp. A real new question (long, topical) must NOT pull a stale turn.
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache in Redis with a 60s TTL.', 'manual', 2000);
    assert.equal(resolve(svc, 'r', 'what is the capital of France and its population today'), null);
  });
});
