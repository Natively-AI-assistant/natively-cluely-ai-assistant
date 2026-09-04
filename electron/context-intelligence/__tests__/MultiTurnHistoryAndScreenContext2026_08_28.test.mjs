// The community-reported defect: "i shared a ss, but then when asked for a
// follow up, its like he has no idea of that ss" (Telegram, 2026-08-28,
// reproduced on both macOS and Windows).
//
// Root cause was NOT image-specific. Chat history on the default V3 path was a
// SLIDING WINDOW OF ONE TURN, with the answer capped at 280 chars and labelled
// "NOT evidence". Measured before this fix, over three turns:
//
//   turn 1  "What is wrong with this code?" + screenshot
//   turn 2  "How do I fix it?"
//   turn 3  "What was the project name in that screenshot?"
//           -> prompt contained ONLY turn 2, and an instruction to say the
//              value could not be retrieved.
//
// The mechanism: orchestrate() calls advanceConversationState mid-turn, and
// advance() reset previousAnswerSummary to undefined because the store's
// AdvanceTurnInput never carried the answerSummary field that AdvanceInput
// already declared and advance() already consumed. The carry-forward was
// designed and never wired.
//
// This is a REGRESSION dated to V3's default-ON flip (2026-07-30): the legacy
// path retains 100 turns of untruncated Q/A (ConversationMemoryService), and
// still does — V3 simply never read it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-multiturn-'));

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { advance, emptyState, MAX_HISTORY_TURNS } = await import(
  pathToFileURL(path.join(base, 'question/conversation-state.js')).href);
const store = await import(
  pathToFileURL(path.join(base, 'question/conversation-state-store.js')).href);
const { buildV3Prompt } = await import(
  pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(
  pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { createScreenRetrievalPort } = await import(
  pathToFileURL(path.join(base, 'retrieval/screen-retrieval-port.js')).href);

process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

const SCOPE_A = { userId: 'local', sessionId: 'sess-a' };
const SCOPE_B = { userId: 'local', sessionId: 'sess-b' };

describe('conversation-state — the history ring', () => {
  test('advance() carries a completed turn into the ring', () => {
    const s1 = advance(null, { scope: SCOPE_A, question: 'Q1', answerSummary: 'A1', at: 1 });
    // The turn is only COMPLETE once its answer is known, so the ring holds the
    // pair, not a dangling question.
    assert.deepEqual(s1.turns, [{ q: 'Q1', a: 'A1' }]);
  });

  test('a turn with no answer yet does not enter the ring', () => {
    const s = advance(null, { scope: SCOPE_A, question: 'Q1', at: 1 });
    assert.deepEqual(s.turns, [], 'an unanswered turn is not history yet');
  });

  test('the ring ACCUMULATES across turns — this is the actual bug', () => {
    let s = advance(null, { scope: SCOPE_A, question: 'Q1', answerSummary: 'A1', at: 1 });
    s = advance(s, { scope: SCOPE_A, question: 'Q2', answerSummary: 'A2', at: 2 });
    s = advance(s, { scope: SCOPE_A, question: 'Q3', answerSummary: 'A3', at: 3 });
    assert.deepEqual(s.turns, [
      { q: 'Q1', a: 'A1' }, { q: 'Q2', a: 'A2' }, { q: 'Q3', a: 'A3' },
    ], 'turn 3 must still be able to see turn 1');
  });

  test('the ring is BOUNDED — oldest evicted', () => {
    let s = null;
    for (let i = 1; i <= MAX_HISTORY_TURNS + 5; i++) {
      s = advance(s, { scope: SCOPE_A, question: `Q${i}`, answerSummary: `A${i}`, at: i });
    }
    assert.equal(s.turns.length, MAX_HISTORY_TURNS);
    assert.equal(s.turns[0].q, `Q6`, 'oldest turns are evicted, newest kept');
    assert.equal(s.turns.at(-1).q, `Q${MAX_HISTORY_TURNS + 5}`);
  });

  test('answers are stored UNTRUNCATED at 280 chars — the old cap is gone', () => {
    const long = 'x'.repeat(2000);
    const s = advance(null, { scope: SCOPE_A, question: 'Q', answerSummary: long, at: 1 });
    assert.ok(s.turns[0].a.length > 280,
      `expected more than the old 280-char cap, got ${s.turns[0].a.length}`);
  });

  test('a SCOPE change clears the ring — no cross-session bleed', () => {
    let s = advance(null, { scope: SCOPE_A, question: 'Q1', answerSummary: 'A1', at: 1 });
    s = advance(s, { scope: SCOPE_B, question: 'Q2', answerSummary: 'A2', at: 2 });
    assert.deepEqual(s.turns, [{ q: 'Q2', a: 'A2' }],
      'a different session must not inherit the previous session history');
  });

  test('emptyState has an empty ring', () => {
    assert.deepEqual(emptyState(SCOPE_A).turns, []);
  });
});

describe('conversation-state-store — recordAnswerSummary completes the open turn', () => {
  test('the question advances first, the answer completes it after the stream', () => {
    const sid = 'store-1';
    store.clearConversationState(sid);
    store.advanceConversationState({ sessionId: sid, scope: { userId: 'local', sessionId: sid }, question: 'Q1' });
    // Mid-turn: the question is known, the answer is not.
    assert.deepEqual(store.getConversationState(sid).turns, []);
    store.recordAnswerSummary(sid, 'A1');
    assert.deepEqual(store.getConversationState(sid).turns, [{ q: 'Q1', a: 'A1' }]);
  });

  test('a second turn does not destroy the first — the regression, directly', () => {
    const sid = 'store-2';
    store.clearConversationState(sid);
    const scope = { userId: 'local', sessionId: sid };
    store.advanceConversationState({ sessionId: sid, scope, question: 'Q1' });
    store.recordAnswerSummary(sid, 'A1');
    store.advanceConversationState({ sessionId: sid, scope, question: 'Q2' });
    store.recordAnswerSummary(sid, 'A2');
    assert.deepEqual(store.getConversationState(sid).turns,
      [{ q: 'Q1', a: 'A1' }, { q: 'Q2', a: 'A2' }]);
  });

  test('a truncated turn records no answer and leaves no half-turn behind', () => {
    const sid = 'store-3';
    store.clearConversationState(sid);
    const scope = { userId: 'local', sessionId: sid };
    store.advanceConversationState({ sessionId: sid, scope, question: 'Q1' });
    // stream truncated -> ipcHandlers skips recordAnswerSummary
    store.advanceConversationState({ sessionId: sid, scope, question: 'Q2' });
    store.recordAnswerSummary(sid, 'A2');
    assert.deepEqual(store.getConversationState(sid).turns, [{ q: 'Q2', a: 'A2' }],
      'the abandoned turn must not appear with an empty answer');
  });
});

describe('engine-bridge — the rendered history block', () => {
  const turn = (sessionId, question, n, extra = {}) => buildV3Prompt({
    surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
    requestId: `t-${n}`, requestSequence: n,
    scope: { userId: 'local', sessionId }, ...extra,
  });

  test('turn 3 can still see turn 1 — the reported bug, end to end', async () => {
    const sid = 'bridge-1';
    store.clearConversationState(sid);
    await turn(sid, 'What is wrong with this code?', 1, { hasScreenContext: true });
    store.recordAnswerSummary(sid,
      'The screenshot shows VS Code with graph.py open. Line 14 raises TypeError because '
      + 'visited is a list, not a set. The sidebar shows project orbit-router with 12 files.');
    await turn(sid, 'How do I fix it?', 2);
    store.recordAnswerSummary(sid, 'Change `visited = []` to `visited = set()` on line 12.');
    const t3 = await turn(sid, 'What was the project name in that screenshot?', 3);

    assert.match(t3.user, /orbit-router/,
      'turn 3 asked about the screenshot and must still carry turn 1 in its prompt');
    assert.match(t3.user, /How do I fix it\?/, 'and turn 2');
  });

  test('history renders as an ordered multi-turn exchange', async () => {
    const sid = 'bridge-2';
    store.clearConversationState(sid);
    await turn(sid, 'Q1', 1);
    store.recordAnswerSummary(sid, 'A1');
    await turn(sid, 'Q2', 2);
    store.recordAnswerSummary(sid, 'A2');
    const t3 = await turn(sid, 'Q3', 3);
    const iQ1 = t3.user.indexOf('Q1');
    const iQ2 = t3.user.indexOf('Q2');
    assert.ok(iQ1 >= 0 && iQ2 > iQ1, 'oldest turn first, newest last');
  });

  test('an empty history renders no history block at all', async () => {
    const sid = 'bridge-3';
    store.clearConversationState(sid);
    const t1 = await turn(sid, 'What is a mutex?', 1);
    assert.ok(!/Conversation so far/.test(t1.user),
      'a first turn must not claim a conversation it does not have');
  });
});

describe('screen-retrieval-port — SCREEN_CONTEXT finally has a producer', () => {
  // The port's contract is `retrieve({ decision })`, so its filtering behaviour
  // is exercised through buildV3Prompt below rather than with a hand-built
  // TurnDecision — a fake decision would test the fake, not the pipeline.
  test('an empty description produces no port at all', () => {
    assert.equal(createScreenRetrievalPort({ description: '   ', userId: 'local', sessionId: 's' }), null);
    assert.equal(createScreenRetrievalPort({ description: '', userId: 'local', sessionId: 's' }), null);
  });

  test('a real description produces a port', () => {
    assert.ok(createScreenRetrievalPort({
      description: 'VS Code with graph.py open.', userId: 'local', sessionId: 's',
    }));
  });
});

describe('a screenshot turn is no longer told that nothing was retrieved', () => {
  test('with screen evidence, the no-evidence refusal is not emitted', async () => {
    const sid = 'screen-turn-1';
    store.clearConversationState(sid);
    const port = createScreenRetrievalPort({
      description: 'VS Code with graph.py open; line 14 raises TypeError; project orbit-router.',
      userId: 'local', sessionId: sid,
    });
    const composed = await buildV3Prompt({
      surface: 'manual-chat', pathTag: 'ipc',
      question: 'What is wrong with this code?',
      hasScreenContext: true, modeTemplateType: 'general',
      requestId: 'st-1', requestSequence: 1,
      scope: { userId: 'local', sessionId: sid },
      retrieval: port,
    });
    assert.ok(composed, 'expected a prompt');
    assert.ok(!/No supporting evidence was retrieved/.test(composed.user),
      'the image is in the payload — the model must not be told nothing was retrieved');
    assert.ok(composed.evidenceCount > 0, 'the screenshot IS the evidence for this turn');
  });
});

describe('an empty-evidence turn WITH history is not told to refuse', () => {
  // Carrying the history forward is only half the fix. Turn 3 was told twice
  // not to use it: the history header said "never a source of facts", and the
  // evidence block said "say the exact value could not be retrieved". A
  // cautious model then answers "I can't retrieve that" — the reported symptom,
  // with better plumbing behind it.
  //
  // The bounded exception is about PROVENANCE, not about relaxing §12.3. A
  // prior ASSISTANT line is a model-generated claim and stays referent-only:
  // promoting it is the self-reinforcing fabrication RC3 exists to prevent. A
  // `[screen attached that turn]` line is an OBSERVATION of the user's own
  // screen made by a vision provider. Collapsing those two into one warning is
  // what made the screenshot unreadable.
  const turn = (sessionId, question, n) => buildV3Prompt({
    surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
    requestId: `ne-${n}`, requestSequence: n, scope: { userId: 'local', sessionId },
  });

  test('the refusal instruction is gone once there is history to read', async () => {
    const sid = 'noev-1';
    store.clearConversationState(sid);
    await turn(sid, 'What is wrong with this code?', 1);
    store.recordAnswerSummary(sid, 'Line 14 fails because visited is a list.',
      'VS Code on graph.py; sidebar shows project orbit-router with 12 files.');
    const t2 = await turn(sid, 'What was the project name in that screenshot?', 2);

    assert.ok(!/say the exact value could not be retrieved/.test(t2.user),
      'the value IS available — in the screen line of the previous turn');
    assert.ok(!/the uploaded material does not cover this/.test(t2.user),
      'no document was ever the subject; do not blame one');
  });

  test('a FIRST turn with no history keeps the existing copy verbatim', async () => {
    const sid = 'noev-2';
    store.clearConversationState(sid);
    const t1 = await turn(sid, 'What did the Q3 revenue report say?', 1);
    assert.match(t1.user, /No supporting evidence was retrieved/,
      'with nothing to read, the honest answer is still that nothing was retrieved');
  });

  test('the screen line is readable as observation; assistant lines stay referent-only', async () => {
    const sid = 'noev-3';
    store.clearConversationState(sid);
    await turn(sid, 'What is on my screen?', 1);
    store.recordAnswerSummary(sid, 'A failing test.', 'The terminal shows 3 failing pytest tests.');
    const t2 = await turn(sid, 'How many were failing?', 2);
    assert.match(t2.user, /observed/i,
      'the screen line must be marked as an observation the model may rely on');
    assert.match(t2.user, /not evidence|prior generated output/i,
      'assistant lines must still be fenced as referent-only (RC3)');
  });
});

describe('the rendered history honours the mode\'s declared conversation budget', () => {
  // The ring is bounded by construction (10 turns x 1200 chars), but a FULL
  // ring is ~4k tokens — past every mode's declared conversationTokens, a field
  // only ever declared and never read by the packer. Enforcing it here is what
  // stops this fix from adding a second decorative budget to the subsystem
  // whose zero-producer SCREEN_CONTEXT caused the original bug.
  const turn = (sessionId, question, n) => buildV3Prompt({
    surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
    requestId: `bg-${n}`, requestSequence: n, scope: { userId: 'local', sessionId },
  });

  test('a full ring of long answers stays within budget, newest kept', async () => {
    const sid = 'budget-1';
    store.clearConversationState(sid);
    for (let i = 1; i <= 12; i++) {
      await turn(sid, `Question number ${i}`, i);
      store.recordAnswerSummary(sid, `ANSWER${i} ` + 'x'.repeat(1200));
    }
    const last = await turn(sid, 'And finally?', 99);
    // general mode declares 2400 conversationTokens => ~9600 chars of history.
    const block = last.user.slice(last.user.indexOf('# Conversation so far'));
    assert.ok(block.length < 12000, `history block was ${block.length} chars — budget not enforced`);
    assert.match(last.user, /ANSWER12/, 'the most recent exchange must survive');
    assert.ok(!/ANSWER1\b/.test(last.user), 'the oldest exchanges are dropped first');
  });

  test('a single over-budget exchange is still kept — a follow-up needs an antecedent', async () => {
    const sid = 'budget-2';
    store.clearConversationState(sid);
    await turn(sid, 'One huge question', 1);
    store.recordAnswerSummary(sid, 'HUGEANSWER ' + 'y'.repeat(1200), 'HUGESCREEN ' + 'z'.repeat(1200));
    const t2 = await turn(sid, 'What was on the screen?', 2);
    assert.match(t2.user, /HUGESCREEN/, 'dropping the only exchange would strand the follow-up');
  });
});

describe('the Settings toggle (Intelligence > Memory > "Chat history")', () => {
  // The flag lives in the intelligence registry and its VALUE is passed into the
  // bridge, rather than read there: electron/context-intelligence/ deliberately
  // has no dependency on that registry (contracts/retrieval-flags.ts records
  // what the first import would cost — 20 of its 62 flags resolve differently in
  // dev/test, which is how composePrompt and assistantClaims shipped inert).
  const turn = (sessionId, question, n, multiTurnHistory) => buildV3Prompt({
    surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
    requestId: `tg-${n}`, requestSequence: n,
    scope: { userId: 'local', sessionId }, multiTurnHistory,
  });

  const seed = async (sid, flag) => {
    store.clearConversationState(sid);
    await turn(sid, 'What is wrong with this code?', 1, flag);
    store.recordAnswerSummary(sid, 'Line 14 fails because visited is a list.',
      'VS Code on graph.py; sidebar shows project orbit-router.');
    await turn(sid, 'How do I fix it?', 2, flag);
    store.recordAnswerSummary(sid, 'Change visited to a set.');
    return turn(sid, 'What was the project name in that screenshot?', 3, flag);
  };

  test('ON (default, undefined) — the full ring reaches the prompt', async () => {
    const t3 = await seed('toggle-on', undefined);
    assert.match(t3.user, /orbit-router/, 'turn 3 must still see turn 1');
    assert.match(t3.user, /How do I fix it\?/);
  });

  test('ON (explicit true) behaves identically to undefined', async () => {
    const t3 = await seed('toggle-true', true);
    assert.match(t3.user, /orbit-router/);
  });

  test('OFF — a genuine rollback to the one-turn window', async () => {
    const t3 = await seed('toggle-off', false);
    assert.ok(!/orbit-router/.test(t3.user), 'the older turn must not be carried');
    assert.match(t3.user, /Previous question: How do I fix it\?/,
      'the pre-fix one-turn block is what OFF restores');
    assert.match(t3.user, /No supporting evidence was retrieved/,
      'OFF restores the old no-evidence notice too — not a half-disabled state');
  });
});

describe('the flag registry entry', () => {
  test('chatHistoryMultiTurn is registered and defaults ON', async () => {
    const flags = await import(pathToFileURL(path.resolve(
      process.cwd(), 'dist-electron/electron/intelligence/intelligenceFlags.js')).href);
    assert.equal(flags.isIntelligenceFlagEnabled('chatHistoryMultiTurn'), true,
      'the fix must be what users get by default; a dev/test-only default would '
      + 'pin a behaviour nobody receives');
  });

  test('the env var is an operator kill switch, both directions', async () => {
    const flags = await import(pathToFileURL(path.resolve(
      process.cwd(), 'dist-electron/electron/intelligence/intelligenceFlags.js')).href);
    const prev = process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN;
    try {
      process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN = '0';
      assert.equal(flags.isIntelligenceFlagEnabled('chatHistoryMultiTurn'), false);
      process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN = '1';
      assert.equal(flags.isIntelligenceFlagEnabled('chatHistoryMultiTurn'), true);
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN;
      else process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN = prev;
    }
  });
});
