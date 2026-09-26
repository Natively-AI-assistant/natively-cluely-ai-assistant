// Independent review of the merged 2026-08-09 work found two ways the new
// self-contained-subject gate is TOO EAGER. Both measured, both regressions
// against behaviour that worked before that change, and both shipped to main.
//
// 1. RELATIONAL / ANAPHORIC PHRASES READ AS SUBJECTS.
//    `ownSubjectPhrase` accepts anything `extractTopicPhrase` returns, and that
//    extractor was built for the STATE-ADVANCE path — deciding what to store as
//    `activeTopic`. A phrase good enough to STORE is not evidence the question
//    is SELF-CONTAINED. "timeline" is a fine topic; "What about the timeline?"
//    is purely anaphoric.
//
//    Worse, the accepted head noun is often a member of CONTINUATION_NOUN_RE
//    itself — "difference", "steps", "tradeoffs" — nouns the classifier already
//    declares cannot denote on their own. The gate sits AHEAD of the
//    continuation-fragment branch it thereby pre-empts, recreating exactly the
//    "two gates disagreeing" failure the fragment class was written to close.
//
// 2. A SHORT QUOTED TERM IS NOT A QUOTED SUBJECT.
//    The double-quote branch of QUOTED_SUBJECT_RES has none of the
//    discrimination the single-quote branch has: no boundary rule, a 2-char
//    minimum, and it returns unconditionally ahead of every other gate. So
//    `Did she say "no"?` loses its activePerson binding to a quoted word.
//
// The fix keeps the 2026-08-09 intent — a question that genuinely states its
// own subject must not inherit a stale topic — while restoring anaphora.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { resolveReference, advance } =
  await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);

const SCOPE = { userId: 'u1', sessionId: 's1' };
const after = (...turns) => turns.reduce((st, q) => advance(st, { scope: SCOPE, question: q, at: 0 }), null);

describe('anaphoric follow-ups still resolve (regression, 2026-08-10)', () => {
  const st = () => after('Tell me about the Cassandra migration timeline');

  for (const q of [
    'What about the timeline?',
    'What about salary?',
    'What about the tradeoffs?',
    'Can you explain the difference?',
    'Can you explain the steps?',
    'Explain the difference.',
    'What about the alternatives?',
  ]) {
    test(`resolves: ${q}`, () => {
      const r = resolveReference(q, st());
      assert.equal(r.usedState, true,
        `an anaphoric follow-up must still bind to state; reason=${r.reason}`);
    });
  }

  test('PRE-EXISTING gap, not a regression: "Can you give me the pros and cons?"', () => {
    // Documented rather than asserted as working. `extractTopicPhrase` returns
    // undefined here, so the 2026-08-09 gate never even runs — the turn fails
    // the pronoun/bare/rephrase trigger check and passes through untouched,
    // exactly as it did before that change. It is 8 words, over
    // FRAGMENT_MAX_WORDS, so isContinuationFragment declines it too.
    //
    // Pinned so a future reader does not mistake it for fallout from the
    // self-contained-subject work. Fixing it means widening the fragment cap or
    // the trigger set, which is a separate decision.
    const r = resolveReference('Can you give me the pros and cons?', st());
    assert.equal(r.usedState, false);
    assert.equal(r.reason, 'NO_REFERENT_TRIGGER',
      'if this becomes a real trigger, the gap is closed and this test should assert resolution');
  });
});

describe('a short quoted TERM is not a subject (regression, 2026-08-10)', () => {
  const st = () => after("What is Priya's strongest signal?");

  for (const q of [
    'Why did she call it "flaky"?',
    'Did she say "no"?',
    'What did he mean by "scope"?',
  ]) {
    test(`resolves: ${q}`, () => {
      const r = resolveReference(q, st());
      assert.equal(r.usedState, true,
        `a quoted single term must not suppress resolution; reason=${r.reason}`);
    });
  }

  test('a quoted single term still binds the personal pronoun to the person', () => {
    const r = resolveReference('Did she say "no"?', st());
    assert.match(r.resolved, /Priya/);
  });
});

describe('the 2026-08-09 intent is preserved — self-contained turns still do NOT inherit', () => {
  const st = () => after('What do you think about remote work?');

  for (const q of [
    // quoted SUBJECT — a full clause, not a term
    'Give me an example answer for "Why do you want this role?"',
    "Give me an example answer for 'Why do you want this role?'",
    'How should I answer "What is your greatest weakness?"',
    // lowercase subject
    'How do database indexes work?',
    'How should I answer a question about salary expectations?',
    'What should I say about compensation banding?',
  ]) {
    test(`unchanged: ${q}`, () => {
      const r = resolveReference(q, st());
      assert.equal(r.usedState, false, `must not inherit "remote work"; got ${r.resolved}`);
    });
  }
});

describe('nothing else regresses', () => {
  test('bare fragment still anchors', () => {
    assert.equal(resolveReference('examples?', after('What is a REST API?')).usedState, true);
  });
  test('"Why not?" still binds the newest subject', () => {
    const r = resolveReference('Why not?', after('What is a mutex?', 'What is a semaphore?'));
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /semaphore/i);
  });
  test('pronoun follow-up still resolves', () => {
    assert.equal(resolveReference('Can you explain it more simply?', after('What is a B-tree?')).usedState, true);
  });
  test('personal pronoun still binds the person across a tech turn', () => {
    const r = resolveReference('Has she used GCP?', after("What is Priya's strongest signal?", 'What is a mutex?'));
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /Priya/);
  });
  test('a long self-contained turn still binds its own pronoun', () => {
    const r = resolveReference(
      'I paid for the subscription yesterday but the app still shows the free plan, please fix this.',
      after('What is a bloom filter?'));
    assert.equal(r.usedState, false);
  });
});
