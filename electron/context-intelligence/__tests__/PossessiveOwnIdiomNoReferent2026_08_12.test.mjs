// electron/context-intelligence/__tests__/PossessiveOwnIdiomNoReferent2026_08_12.test.mjs
//
// Live report 2026-08-12, manual chat in Recruiting mode. The turn before was
// about Makefiles; the user then asked a physics question:
//
//   "Explain mass-energy equivalence. Put the formula on its own line as $$E=mc^2$$."
//
// and the V3 log showed:
//
//   resolvedQuestion: "... $$E=mc^2$$. (referring to: Makefile)"
//   intent: [PERSONAL_PROJECT, DOCUMENT_FACT, FOLLOW_UP]
//   answerability: NONE  fallback: DOCUMENT_FACT_NOT_FOUND
//
// The `its` of "its own line" matched NONPERSON_PRONOUN_RE, the question was
// exactly 12 words so `shortTurn` held, and the explicit-entity guards ahead of
// the referent all require `!pronoun` — so an unrelated topic was glued onto a
// self-contained question and then drove retrieval.
//
// `its own` / `their own` is a fixed idiom meaning "separate / dedicated". Its
// antecedent is the noun it modifies, which is present locally by construction,
// so it can never point outside the sentence. It is stripped for pronoun
// DETECTION only.
//
// Scope note: this closes one idiom. Deciding in general whether a non-personal
// pronoun binds locally is NOT solved. Two broader fixes were measured and
// rejected — see NONREFERENTIAL_POSSESSIVE_RE in conversation-state.ts.

import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';
import {
  resolveReference,
  advance,
  emptyState,
} from '../../../dist-electron/electron/context-intelligence/question/conversation-state.js';

const scope = { userId: 'u1', meetingId: 'm1', modeId: 'recruiting' };

let state;
beforeEach(() => {
  // Reproduce the user's session: a Makefile turn immediately before, which is
  // what populated activeTopic.
  state = advance(emptyState(scope), {
    scope,
    question: 'Show a Makefile rule using $@ and $<.',
    answerSummary: 'output.txt: input.txt; cp $< $@',
  });
});

describe('the `its own` idiom does not inherit a referent', () => {
  test('the reported physics question stays untouched', () => {
    const q = 'Explain mass-energy equivalence. Put the formula on its own line as $$E=mc^2$$.';
    const r = resolveReference(q, state);
    assert.equal(r.usedState, false, `inherited a referent: ${r.resolved}`);
    assert.equal(r.resolved, q, 'the question must reach retrieval verbatim');
    assert.doesNotMatch(r.resolved, /referring to/);
  });

  test('the word count that made it fragile is confirmed, not relied upon', () => {
    // The question sits EXACTLY on PRONOUN_RESOLUTION_MAX_WORDS (12), which is
    // why it triggered at all. Pin that so nobody "fixes" this by nudging the
    // threshold — one word either way would have hidden the bug rather than
    // solved it, and the same shape would still break at a different length.
    const q = 'Explain mass-energy equivalence. Put the formula on its own line as $$E=mc^2$$.';
    assert.equal(q.split(/\s+/).filter(Boolean).length, 12);
  });

  test('other `its own` phrasings are covered', () => {
    const q = 'Show the config and put each key on its own line.';
    const r = resolveReference(q, state);
    assert.equal(r.usedState, false, `inherited a referent for: ${q}`);
  });
});

describe('KNOWN LIMIT — a locally-bound pronoun outside the idiom still inherits', () => {
  // Documented, not fixed. This asserts CURRENT behaviour so the boundary of
  // the fix is visible in the suite rather than discovered in production.
  //
  // "Split the helpers so THEY each live in their own file." — `they` binds to
  // "the helpers", present in the same sentence, so no referent should be
  // inherited. The idiom strip removes "their own" but not the separate `they`,
  // and `they` is indistinguishable by pattern from the referential use in
  // "Are they still hiring?".
  //
  // Deciding this in general needs to know whether a candidate antecedent
  // precedes the pronoun in the same sentence. extractEntities cannot answer
  // that — it reports sentence-initial capitals as entities ("Put") and carries
  // no positions. That is the work this fix deliberately does not attempt.
  //
  // If this test ever starts FAILING, the general case has been solved and this
  // block should be deleted, not adjusted.
  test('is still contaminated (expected)', () => {
    const q = 'Split the helpers so they each live in their own file.';
    const r = resolveReference(q, state);
    assert.equal(
      r.usedState,
      true,
      'this case now resolves correctly — the general fix landed; delete this block',
    );
  });
});

describe('genuinely referential pronouns still resolve', () => {
  // Guard against over-correction. The idiom strip must not disable pronoun
  // resolution generally — each of these NEEDS the previous turn's topic.
  const MUST_INHERIT = [
    // The canonical 2026-08-02 case that added `its` in the first place: `its`
    // NOT followed by `own` is still a live referential pronoun.
    'What is its time complexity?',
    // A separate `it` in the same sentence as an `its own` idiom must still
    // trigger — only the idiom is neutralised, not the whole question.
    'Put it on its own line.',
    'What is it?',
    'Why not?',
    'Can you optimize that?',
    'Can you explain that in the context of Kubernetes?',
  ];
  for (const q of MUST_INHERIT) {
    test(`"${q}" still resolves against state`, () => {
      const r = resolveReference(q, state);
      assert.equal(r.usedState, true, `lost its referent: ${q}`);
      assert.match(r.resolved, /referring to|follow-up to|rephrasing request/);
    });
  }
});

describe('the strip touches detection only, never the question', () => {
  test('a resolved question keeps its original wording including `its own`', () => {
    // If the strip leaked into `q`, retrieval would receive a question with the
    // idiom deleted — quietly changing what was asked.
    const r = resolveReference('Put it on its own line.', state);
    assert.match(r.resolved, /Put it on its own line\./, `wording was altered: ${r.resolved}`);
  });
});
