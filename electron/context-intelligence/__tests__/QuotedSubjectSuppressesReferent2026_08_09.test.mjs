// Live manual repro 2026-08-09 (Team Meet, zero files, ambient chat):
//
//   turn 1  "What do you think about remote work?"        → activeTopic = remote work
//   turn 2  'Give me an example answer for "Why do you want this role?"'
//
// The [V3] line showed the resolver had rewritten turn 2 as
//
//   ... (referring to: remote work)
//
// and the model duly produced an example answer ABOUT REMOTE WORK — not about
// why the candidate wants the role. Turn 3 ("What should I say next?") then
// inherited the corruption and was also about remote work. Two of the six
// answers in a manual test run were wrong, silently.
//
// ROOT CAUSE — resolveReference's self-contained guard is
//
//   if (!pronoun && !rephrase && extractEntities(q).length > 0) …
//
// so it is skipped whenever the turn carries a pronoun OR is a response
// request. But a turn can be BOTH a rephrase request AND carry its own
// explicit subject in quotes: 'Give me an example answer for "Why do you want
// this role?"' is a response request (skipping the guard) and contains the
// pronoun "you" in a short turn (skipping it again). Inherited state then won
// over a subject the user had written out verbatim.
//
// A quoted span is the strongest possible statement of subject a user can
// make. It must beat inherited state unconditionally.
//
// The near-miss that proves the gap was accidental rather than designed:
// 'Give me an example answer for "Tell me about a conflict you resolved"'
// escaped ONLY because it is 11 words and fails the shortTurn check. Same
// shape, opposite outcome, decided by word count.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { resolveReference } = await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);

// The exact state the live session was in after turn 1.
const remoteWorkState = {
  activeTopic: 'remote work',
  activeEntities: ['remote work'],
  activePerson: null,
  previousQuestion: 'What do you think about remote work?',
  previousAnswerSummary: 'Remote work has upsides and tradeoffs.',
  turnCount: 1,
};

describe('a quoted subject suppresses inherited referents', () => {
  for (const q of [
    'Give me an example answer for "Why do you want this role?"',
    "Give me an example answer for 'Why do you want this role?'",
    'How should I answer "What is your greatest weakness?"',
    'What should I say to "Tell me about yourself"?',
    'Give me an example answer for “Why do you want this role?”',
  ]) {
    test(`unchanged: ${q}`, () => {
      const r = resolveReference(q, remoteWorkState);
      assert.equal(r.resolved, q,
        `a question that quotes its own subject must not inherit state:\n  ${r.resolved}`);
      assert.equal(r.usedState, false, `reason was: ${r.reason}`);
      assert.ok(!/remote work/i.test(r.resolved), 'the stale topic must not appear');
    });
  }

  test('the near-miss that only escaped on word count now escapes on purpose', () => {
    const q = 'Give me an example answer for "Tell me about a conflict you resolved"';
    const r = resolveReference(q, remoteWorkState);
    assert.equal(r.resolved, q);
    assert.equal(r.reason, 'CURRENT_QUESTION_CONTAINS_EXPLICIT_ENTITY',
      'previously NO_REFERENT_TRIGGER — correct outcome, accidental reason');
  });
});

describe('genuine follow-ups still resolve — the behaviour this must not cost', () => {
  test('a bare rephrase request with NO quoted subject still anchors', () => {
    const r = resolveReference('What should I say next?', remoteWorkState);
    assert.equal(r.usedState, true, 'this one genuinely needs the previous turn');
    assert.match(r.resolved, /rephrasing request/);
  });

  test('a bare pronoun follow-up still resolves to the active topic', () => {
    const r = resolveReference('Why not?', remoteWorkState);
    assert.equal(r.usedState, true, `reason: ${r.reason}`);
  });

  test('a short pronoun follow-up still resolves', () => {
    const r = resolveReference('Can you explain it more simply?', remoteWorkState);
    assert.equal(r.usedState, true, `reason: ${r.reason}`);
  });

  test('a personal pronoun still resolves to the active person', () => {
    const r = resolveReference('What did she decide?', { ...remoteWorkState, activePerson: 'Priya' });
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /Priya/);
  });

  test('a continuation fragment still anchors to the previous question (2026-08-02)', () => {
    const r = resolveReference('examples?', {
      ...remoteWorkState, activeTopic: 'rest api', previousQuestion: 'What is a REST API?',
    });
    assert.equal(r.usedState, true, `reason: ${r.reason}`);
  });

  test('an apostrophe is not a quote — possessives must not suppress resolution', () => {
    // "don't" / "role's" contain a straight apostrophe. If the quoted-span
    // detector treated those as an opening quote it would silently disable
    // resolution for a large class of ordinary follow-ups.
    const r = resolveReference("Why doesn't that work?", remoteWorkState);
    assert.equal(r.usedState, true, `an apostrophe must not read as a quoted subject; reason: ${r.reason}`);
  });

  test('an EMPTY or single-character quote is not a subject', () => {
    const r = resolveReference('What should I say next? ""', remoteWorkState);
    assert.equal(r.usedState, true, `reason: ${r.reason}`);
  });
});
