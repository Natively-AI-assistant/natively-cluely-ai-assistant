// The last two leaks from the 2026-08-09 multi-turn probe: SELF-CONTAINED
// questions with LOWERCASE subjects inherited a stale topic.
//
//   "What do you think about remote work?"                        (sets topic)
//   "How do database indexes work?"
//     → How do database indexes work? (referring to: remote work)
//
//   "How should I answer a question about salary expectations?"
//     → … (rephrasing request: …, topic: remote work)
//
// TWO different mechanisms, same symptom:
//
//   1. The self-contained guard is reachable here but fails, because it tests
//      `extractEntities`, which is CAPITALISATION-GATED. "database indexes" has
//      no capital, so the question looks subjectless. (It reaches the guard at
//      all because FOLLOW_UP_RE starts with `how` and the question is exactly
//      FOLLOW_UP_MAX_WORDS = 5 words.)
//   2. The rephrase branch never consults the guard at all — even though
//      extractTopicPhrase already returns the correct "salary expectations".
//
// THE TRAP, and why the obvious fix is wrong: extractTopicPhrase returns
// "it simply" for "Can you explain it more simply?". Using it in the guard
// unconditionally would classify a genuine follow-up as self-contained and stop
// it resolving. A topic phrase therefore counts as a subject ONLY when it
// contains no pronoun — a phrase built out of pronouns is residue, not a
// subject.
//
// Deliberately NOT touched: isBareFollowUp / FOLLOW_UP_RE in turn-classifier.ts.
// Loosening what counts as a follow-up there would change the orchestrator's
// referent cap and the classifier's FOLLOW_UP intent. The guard is the right
// altitude — it exists precisely to say "this turn names its own subject".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { resolveReference, advance, extractTopicPhrase } =
  await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);

const SCOPE = { userId: 'u1', sessionId: 's1' };
const chain = (turns) => turns.reduce((st, q) => advance(st, { scope: SCOPE, question: q, at: 0 }), null);
const afterRemoteWork = () => chain(['What do you think about remote work?']);

describe('a lowercase subject makes a question self-contained', () => {
  for (const q of [
    'How do database indexes work?',
    'How do bloom filters work?',
    'How should I answer a question about salary expectations?',
    'What should I say about compensation banding?',
    'How do I explain a career gap?',
  ]) {
    test(`no stale topic: ${q}`, () => {
      const r = resolveReference(q, afterRemoteWork());
      assert.ok(!/remote work/i.test(r.resolved),
        `stale topic leaked into a self-contained question:\n  ${r.resolved}`);
    });
  }
});

describe('the trap: a pronoun-built phrase is residue, not a subject', () => {
  test('extractTopicPhrase still returns pronoun residue — this is why the guard filters', () => {
    // Pinned so the reason for the pronoun filter stays visible. If the
    // extractor is ever fixed to return undefined here, the filter becomes
    // belt-and-braces rather than load-bearing — still correct.
    const phrase = extractTopicPhrase('Can you explain it more simply?');
    if (phrase !== undefined) {
      assert.match(phrase, /\bit\b/, `expected pronoun residue, got: ${phrase}`);
    }
  });

  for (const q of [
    'Can you explain it more simply?',
    'Can you explain that?',
    'Why not?',
    'How so?',
    'What should I say next?',
    'Can you elaborate?',
  ]) {
    test(`still resolves: ${q}`, () => {
      const r = resolveReference(q, afterRemoteWork());
      assert.equal(r.usedState, true,
        `a genuine follow-up must still resolve; reason=${r.reason}, resolved=${r.resolved}`);
    });
  }
});

describe('nothing else regresses', () => {
  test('a pronoun turn with a capitalised entity still resolves (Has she used GCP?)', () => {
    // The entity "GCP" must NOT make this self-contained — "she" needs the
    // person slot. This is why the guard keeps its `!pronoun` condition.
    const st = chain(["What is Priya's strongest signal?", 'What is a mutex?']);
    const r = resolveReference('Has she used GCP?', st);
    assert.equal(r.usedState, true, `reason: ${r.reason}`);
    assert.match(r.resolved, /Priya/);
  });

  test('a bare rephrase with no own subject still anchors to the previous question', () => {
    const st = chain(['What do you think about remote work?', 'How do I explain a career gap?']);
    const r = resolveReference('What should I say next?', st);
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /rephrasing request/);
  });

  test('a continuation fragment still anchors (2026-08-02)', () => {
    const st = chain(['What is a REST API?']);
    const r = resolveReference('examples?', st);
    assert.equal(r.usedState, true, `reason: ${r.reason}`);
  });

  test('a quoted subject is still self-contained (2026-08-09)', () => {
    const r = resolveReference('Give me an example answer for "Why do you want this role?"', afterRemoteWork());
    assert.equal(r.usedState, false);
  });

  test('subject switch then bare follow-up still binds to the NEW subject', () => {
    const st = chain(['What is a mutex?', 'What is a semaphore?']);
    const r = resolveReference('Why not?', st);
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /semaphore/i);
  });
});
