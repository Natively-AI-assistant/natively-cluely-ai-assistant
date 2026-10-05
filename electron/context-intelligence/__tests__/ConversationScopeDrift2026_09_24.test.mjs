// Conversation memory must survive evidence-scope DRIFT inside one meeting.
//
// Measured live 2026-09-24 (tests/meeting-memory, typed-chat scenario, 3/3
// runs): the meeting overlay's history ring held 7 turns, the JIT transcript
// index came online, and on the very next turn the ring was 1 turn long. The
// user's facts from turns 1-6 were gone from the prompt and the model answered
// "I don't have a budget ceiling from you in this conversation".
//
// Cause: the store is keyed by ONE conversation key per meeting
// (`m:<session>`), but `advance()` reset whenever the turn's EVIDENCE scope
// changed — and inside one meeting that scope drifts by design:
//   typed chat before the index is live   u:local|s:m:<session>
//   typed chat after the index is live    u:local|m:live-meeting-current|s:m:<session>
//   what-to-answer                        u:local|m:<session marker>|s:m:<session>
// The meetingId there is an evidence FILTER (scopeAdmits needs it to admit JIT
// chunks), not the identity of the conversation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (rel) => pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence', rel)).href;
const store = await import(dist('question/conversation-state-store.js'));
const { advance, resolveReference, appendTurn, MAX_TURN_QUESTION_CHARS } = await import(dist('question/conversation-state.js'));

const SESSION = 'm:session_drift_1';
const typedBeforeIndex = { userId: 'local', sessionId: SESSION };
const typedAfterIndex = { userId: 'local', sessionId: SESSION, meetingId: 'live-meeting-current' };
const whatToAnswer = { userId: 'local', sessionId: SESSION, meetingId: 'session_drift_1' };

function turn(scope, q, a) {
  store.advanceConversationState({ sessionId: SESSION, scope, question: q });
  store.recordAnswerSummary(SESSION, a);
}

describe('one meeting, drifting evidence scope', () => {
  test('the live index coming online does not wipe the history ring', () => {
    store.clearConversationState(SESSION);
    turn(typedBeforeIndex, 'The codename is VELVET-KESTREL. Opening line?', 'Try: thanks for joining.');
    turn(typedBeforeIndex, 'Budget ceiling is $83,700. Position premium?', 'Lead with fit.');
    turn(typedBeforeIndex, 'Three discovery questions?', 'What changed, what does success look like, who decides.');
    // The JIT index is live now, so the turn's scope gains the index's meetingId.
    store.advanceConversationState({ sessionId: SESSION, scope: typedAfterIndex, question: 'What budget did I give you?' });
    const s = store.getConversationState(SESSION);
    assert.equal(s.turns.length, 3, 'all three completed exchanges survive the scope gaining a meetingId');
    assert.match(s.turns[1].q, /83,700/);
  });

  test('alternating typed chat and what-to-answer keeps ONE history', () => {
    store.clearConversationState(SESSION);
    turn(typedBeforeIndex, 'Signer is Odalys Brennan-Achebe. What to send her?', 'A short recap.');
    turn(whatToAnswer, 'What should I say about onboarding?', 'Two weeks of setup, then a check-in.');
    turn(typedBeforeIndex, 'Pilot runs at bay Q-47. Risks?', 'Connectivity, layout, load.');
    turn(typedAfterIndex, 'Steer back on topic?', 'Name the goal and pivot.');
    assert.equal(store.getConversationState(SESSION).turns.length, 4);
  });

  test('a referent is still resolved across the drift', () => {
    const s1 = advance(null, { scope: typedBeforeIndex, question: 'Tell me about the Cassandra migration.' });
    const r = resolveReference('What is its timeline?', s1, typedAfterIndex);
    assert.notEqual(r.reason, 'SCOPE_CHANGED');
  });
});

describe('real scope changes still reset', () => {
  test('a different meeting with no session id resets (the reversal corpus case)', () => {
    const s1 = advance(null, { scope: { userId: 'u1', meetingId: 'm1' }, question: 'Are we migrating to ScyllaDB?', answerSummary: 'Yes.' });
    const s2 = advance(s1, { scope: { userId: 'u1', meetingId: 'm2' }, question: 'What did we decide?' });
    assert.equal(s2.turns.length, 0);
    assert.ok(!s2.activeEntities.includes('ScyllaDB'));
  });

  test("the shared 'engine' bucket is not a conversation identity, so it stays strict", () => {
    const s1 = advance(null, { scope: { userId: 'local', sessionId: 'engine', meetingId: 'a' }, question: 'Q about ScyllaDB?', answerSummary: 'A.' });
    const s2 = advance(s1, { scope: { userId: 'local', sessionId: 'engine', meetingId: 'b' }, question: 'Next?' });
    assert.equal(s2.turns.length, 0);
  });

  test('a different user under the same session id resets', () => {
    const s1 = advance(null, { scope: { userId: 'u1', sessionId: SESSION }, question: 'Q about ScyllaDB?', answerSummary: 'A.' });
    const s2 = advance(s1, { scope: { userId: 'u2', sessionId: SESSION, meetingId: 'live-meeting-current' }, question: 'Next?' });
    assert.equal(s2.turns.length, 0);
  });

  test('a different session id resets even with the same meetingId', () => {
    const s1 = advance(null, { scope: { userId: 'local', sessionId: 'm:session_a', meetingId: 'live-meeting-current' }, question: 'Q?', answerSummary: 'A.' });
    const s2 = advance(s1, { scope: { userId: 'local', sessionId: 'm:session_b', meetingId: 'live-meeting-current' }, question: 'Next?' });
    assert.equal(s2.turns.length, 0);
  });
});

// The user's own words are the part of history that carries what they told the
// overlay. Measured live 2026-09-24: a 370-char context message was stored cut
// at 280 chars ("...anything that sound"), so the go-live date at char ~390
// never reached a later prompt — only the assistant's "I don't have the 14
// November deadline" line did, and the model repeated that denial 3/3 runs.
describe('the user side of a history turn is not cut at the referent cap', () => {
  const preamble = 'Okay so a bit more background before the next part of the call, because I think it matters for how '
    + 'we frame the rollout plan: they have been burned twice by vendors who promised a smooth migration and then missed '
    + 'every milestone, their ops lead is skeptical of anything that sounds like a big-bang cutover, and they care a lot '
    + 'about seeing a phased plan with clear owners.';
  const message = `${preamble} Their hard go-live deadline is 14 November. How should I present a phased rollout?`;

  test('a fact past char 280 of the user message survives into the ring', () => {
    assert.ok(message.indexOf('14 November') > 280, 'fixture must put the fact past the old cap');
    const turns = appendTurn([], message, 'Phase it with named owners.');
    assert.match(turns[0].q, /14 November/);
  });

  test('the question cap is still a bound', () => {
    assert.ok(Number.isFinite(MAX_TURN_QUESTION_CHARS) && MAX_TURN_QUESTION_CHARS >= 1000);
    const turns = appendTurn([], 'x'.repeat(MAX_TURN_QUESTION_CHARS * 3), 'a');
    assert.ok(turns[0].q.length <= MAX_TURN_QUESTION_CHARS + 1);
  });
});
