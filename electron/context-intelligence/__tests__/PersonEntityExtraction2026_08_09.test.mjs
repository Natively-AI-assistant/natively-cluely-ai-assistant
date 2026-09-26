// extractPersonEntities captured malformed names, which then reached the
// prompt verbatim as "(referring to: Does Priya)".
//
// Found 2026-08-09 by a stateful multi-turn probe, while verifying that D9's
// person/topic split still held. D9 itself is fine — "she" resolves to the
// active person and survives an intervening tech turn. What was broken was the
// NAME the person slot got filled with.
//
// Three independent defects in one 13-line function:
//
//   1. `/gi` on the TITLE pattern defeated its own capitalisation constraint.
//      `[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?` under `i` matches any letters, so
//      the optional second word swallowed the following lowercase verb:
//        "What did candidate Leena say about scaling?" → "Leena say"
//        "What did Dr Raman conclude yesterday?"       → "Raman conclude"
//
//   2. A sentence-starting capital was absorbed by the POSSESSIVE pattern's
//      optional second word. The add() filter tests the WHOLE captured string
//      against SENTENCE_STARTERS/STOP, which hold single words only, so the
//      two-word capture sailed through:
//        "Does Priya's profile show…?"  → "Does Priya"
//        "Did Marcus's team ship it?"   → "Did Marcus"
//
//   3. The WHO-question cue never fired at all. `\bwho\s+is\s+…` carries no `i`
//      flag, so a sentence-initial "Who" could not match — one of the three
//      documented cues was dead from the start:
//        "Who is Leena?" → []
//
// The conservative core is deliberately UNCHANGED: a bare capitalised token is
// still not a person. That rule is what stops "Kubernetes" becoming "she", and
// it is pinned below.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { extractPersonEntities, advance, resolveReference } =
  await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);

describe('a title cue yields the NAME, not the name plus the next verb', () => {
  for (const [q, want] of [
    ['What did candidate Leena say about scaling?', ['Leena']],
    ['What did Dr Raman conclude yesterday?', ['Raman']],
    ['What did Dr Sarah Chen recommend?', ['Sarah Chen']],
    ['Ask professor Raman about the syllabus.', ['Raman']],
    ['Did Ms Chen approve the budget?', ['Chen']],
  ]) {
    test(q, () => assert.deepEqual(extractPersonEntities(q), want));
  }
});

describe('a possessive cue drops a leading sentence-starter', () => {
  for (const [q, want] of [
    ["Does Priya's profile show Kubernetes experience?", ['Priya']],
    ["Did Marcus's team ship it?", ['Marcus']],
    ["What is Priya's strongest signal?", ['Priya']],
    ["Has Leena's feedback come back yet?", ['Leena']],
    ["Sarah Chen's review is pending.", ['Sarah Chen']],
  ]) {
    test(q, () => assert.deepEqual(extractPersonEntities(q), want));
  }
});

describe('the who-question cue actually fires', () => {
  for (const [q, want] of [
    ['Who is Leena?', ['Leena']],
    ['Who is Sarah Chen?', ['Sarah Chen']],
    ['who is Raman', ['Raman']],
  ]) {
    test(q, () => assert.deepEqual(extractPersonEntities(q), want));
  }
});

describe('the conservative core is unchanged — a bare capital is NOT a person', () => {
  // This is the D9 invariant. Relaxing it is how "Kubernetes" became "she".
  for (const q of [
    'What did Priya say about the roadmap?',
    'Does Priya have Kubernetes experience?',
    'Marcus decided on pricing.',
    'Does Kubernetes support autoscaling?',
    'What is a mutex?',
  ]) {
    test(`no person from: ${q}`, () => assert.deepEqual(extractPersonEntities(q), []));
  }
});

describe('end to end: the person slot reaches the prompt clean', () => {
  const SCOPE = { userId: 'u1', sessionId: 's1' };
  const chain = (turns) => turns.reduce((st, q) => advance(st, { scope: SCOPE, question: q, at: 0 }), null);

  test('"Does Priya\'s …" then a tech turn then "she" → Priya, not "Does Priya"', () => {
    const st = chain(["Does Priya's profile show Kubernetes experience?", 'What is a mutex?']);
    assert.equal(st.activePerson, 'Priya');
    const r = resolveReference('Has she used GCP?', st);
    assert.equal(r.reason, 'PRONOUN_RESOLVED_TO_ACTIVE_PERSON');
    assert.equal(r.resolved, 'Has she used GCP? (referring to: Priya)');
  });

  test('a title cue survives an intervening tech turn without the verb glued on', () => {
    const st = chain(['What did candidate Leena say about scaling?', 'What is a bloom filter?']);
    assert.equal(st.activePerson, 'Leena');
    assert.match(resolveReference('Has she used GCP?', st).resolved, /\(referring to: Leena\)$/);
  });

  test('the person slot stays sticky across a tech turn (D9)', () => {
    const st = chain(["What is Priya's strongest signal?", 'What is a mutex?', 'What is a B-tree?']);
    assert.equal(st.activePerson, 'Priya', 'a tech noun must not evict the person');
  });
});
