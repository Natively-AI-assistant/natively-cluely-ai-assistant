// T5 + T7 — the two continuity defects behind "follow-ups jump to the wrong
// project". Both are in the decision layer, and neither is fixable by better
// chunking.
//
// T5 (RC3) — a bare follow-up loses its own subject's pool.
//   The unclaimed-retrieval fallback consults DOCUMENT pools only and
//   deliberately excludes identity pools, because "Reverse a linked list in
//   Python" must not retrieve resumes (deep-run 2, issue 5). Correct for that
//   case; wrong for the other case it also catches. A bare follow-up ("Why?",
//   "What did you monitor after that?") has no claims of its own BECAUSE its
//   subject lives in the previous turn — and the fallback then denies it the
//   very pool that turn answered from. Measured before the fix:
//
//     looking-for-work  "Why? (referring to: Kubernetes)"  planned [REFERENCE_FILE]
//     recruiting        same                               CANDIDATE_FILE excluded,
//                                                          the mode's PRIORITY-1 source
//
// T7 (RC6) — referent resolution ignored scope.
//   `continuitySourceIds` has always compared `state.scopeId` before reusing
//   source ids. `resolveReference` never did, though it reuses something more
//   dangerous: the active TOPIC, which rewrites the retrieval query itself.
//   `advance()` does reset on scope change — but `orchestrate()` resolves the
//   referent BEFORE it advances, so the first turn after any meeting or mode
//   change resolved against the previous scope's topic. Resetting on write
//   cannot protect a read that happens first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { resolveReference, advance } = await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);

const withFlag = (key, value, fn) => {
  const original = process.env[key];
  process.env[key] = value;
  try { return fn(); } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
};

const SCOPE_A = { userId: 'u', meetingId: 'meeting-a' };
const SCOPE_B = { userId: 'u', meetingId: 'meeting-b' };

const stateFor = (scope, question) => advance(null, { scope, question, at: 0 });

describe('T7 — a referent never crosses a scope boundary', () => {
  test('the same scope still resolves, exactly as before', () => {
    const s = stateFor(SCOPE_A, 'What is the retry policy on Orbit Bridge?');
    const r = resolveReference('Why?', s, SCOPE_A);
    assert.equal(r.usedState, true, `expected resolution, got reason=${r.reason}`);
    assert.notEqual(r.reason, 'SCOPE_CHANGED');
  });

  test('a DIFFERENT scope does not resolve, and says why', () => {
    const s = stateFor(SCOPE_A, 'What is the retry policy on Orbit Bridge?');
    const r = resolveReference('Why?', s, SCOPE_B);
    assert.equal(r.usedState, false);
    assert.equal(r.reason, 'SCOPE_CHANGED');
    assert.equal(r.resolved, 'Why?', 'the question must come through untouched');
  });

  test('the topic from the previous meeting cannot rewrite this turn', () => {
    // The user-visible shape: a follow-up in a NEW meeting silently pointing at
    // the project from the meeting that just ended.
    const s = stateFor(SCOPE_A, 'How does Orbit Bridge handle idempotency?');
    const crossed = resolveReference('What did you monitor after that?', s, SCOPE_B);
    assert.ok(!/Orbit Bridge/i.test(crossed.resolved),
      `a previous scope's topic leaked into this turn: ${crossed.resolved}`);
  });

  test('callers with NO scope behave exactly as before — the check is opt-in', () => {
    const s = stateFor(SCOPE_A, 'What is the retry policy on Orbit Bridge?');
    const withoutScope = resolveReference('Why?', s);
    assert.equal(withoutScope.usedState, true);
    assert.notEqual(withoutScope.reason, 'SCOPE_CHANGED');
  });

  test('the kill switch restores the pre-fix cross-scope resolution', () => {
    const s = stateFor(SCOPE_A, 'What is the retry policy on Orbit Bridge?');
    withFlag('NATIVELY_RETRIEVAL_REFERENT_SCOPE_CHECK', '0', () => {
      const r = resolveReference('Why?', s, SCOPE_B);
      assert.equal(r.usedState, true, 'flag OFF must reproduce the pre-fix behaviour');
      assert.notEqual(r.reason, 'SCOPE_CHANGED');
    });
  });
});

describe('T5 — a retrieval turn records the pools it planned', () => {
  // The carrier the continuity fix needs. `PriorTurnDecision` records selected
  // and ignored source IDs but no source TYPES, so nothing in the state could
  // answer "which pool did the previous turn use?" until this field existed.
  test('planned source types are stored', () => {
    const s = advance(null, {
      scope: SCOPE_A,
      question: 'What is my Kubernetes experience?',
      plannedSourceTypes: ['RESUME', 'PROFILE_FACT'],
      at: 0,
    });
    assert.deepEqual(s.previousPlannedSourceTypes, ['RESUME', 'PROFILE_FACT']);
  });

  test('an intervening FAST turn PRESERVES them rather than clearing them', () => {
    // Same reasoning as `previousDecision`: a definition question between two
    // grounded turns must not erase the pool the follow-up belongs to.
    const first = advance(null, {
      scope: SCOPE_A, question: 'What is my Kubernetes experience?',
      plannedSourceTypes: ['RESUME'], at: 0,
    });
    const fast = advance(first, { scope: SCOPE_A, question: 'What is a mutex?', at: 0 });
    assert.deepEqual(fast.previousPlannedSourceTypes, ['RESUME']);
  });

  test('duplicates are collapsed', () => {
    const s = advance(null, {
      scope: SCOPE_A, question: 'q',
      plannedSourceTypes: ['RESUME', 'RESUME', 'PROFILE_FACT'], at: 0,
    });
    assert.deepEqual(s.previousPlannedSourceTypes, ['RESUME', 'PROFILE_FACT']);
  });

  test('a scope change resets them along with the rest of the state', () => {
    const first = advance(null, {
      scope: SCOPE_A, question: 'What is my Kubernetes experience?',
      plannedSourceTypes: ['RESUME'], at: 0,
    });
    const moved = advance(first, { scope: SCOPE_B, question: 'What did we decide?', at: 0 });
    assert.equal(moved.previousPlannedSourceTypes, undefined);
  });
});
