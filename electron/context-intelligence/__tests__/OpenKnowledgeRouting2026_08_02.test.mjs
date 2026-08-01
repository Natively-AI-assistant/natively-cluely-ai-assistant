// Context Intelligence V3 — open-knowledge routing under SOURCE_FIRST
// ("Use references when relevant"), 2026-08-02.
//
// Five live misroutes, all measured on the current build (repro 2026-08-02):
//
//   1. "Implement a TypeScript function…"  → GROUNDED, planned PROJECT_FILE+
//      CODING_SAMPLE. "TypeScript" is a capitalised token missing from
//      GENERIC_TECH_CAPS, so a self-contained coding task lost the fast path.
//   2. "Explain why the sky appears blue to a 12-year-old." → GROUNDED in every
//      SOURCE_FIRST mode. The bare "12" satisfied \b\d{2,}\b in
//      hasNonGenericProperNoun — an age read as a value lookup.
//   3. "My laptop becomes very hot… What should I check first?" → USER_EMPLOYMENT
//      → RESUME+PROFILE_FACT planned → answerability NONE →
//      DOCUMENT_FACT_NOT_FOUND → "the résumé does not mention this" for a fan
//      question. "my <device>" is ownership of an artifact, not work history.
//   4. "A product costs 2,400 rupees after a 20% discount. What was the original
//      price?" → PERSONAL_PROJECT+DOCUMENT_FACT, RESUME retrieved. The digits
//      made it entity-specific and "what was the original price" read as a
//      definite value lookup — for arithmetic whose operands are IN the question.
//   5. "How do I stop an application from opening automatically when I start my
//      Mac?" → USER_EMPLOYMENT via the possessive "my Mac".
//
// None of these questions can be answered better by any private source, in any
// mode. The mode may change voice; it must not change the factual source
// requirement of the question.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES, MODE_IDS } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { resolveReference, advance } = await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);

const classify = (q, modeId = 'technical-interview', over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

const IDENTITY_SOURCES = ['RESUME', 'PROFILE_FACT', 'JOB_DESCRIPTION', 'CANDIDATE_FILE'];

// ── open-knowledge matrix ────────────────────────────────────────────────────

const OPEN_KNOWLEDGE_QUESTIONS = [
  'Implement a TypeScript function that returns the first non-repeating character in a string.',
  'Explain why the sky appears blue to a 12-year-old.',
  'My laptop becomes very hot and the fans run loudly whenever I open Chrome. What should I check first?',
  'A product costs 2,400 rupees after a 20% discount. What was the original price?',
  'How do I stop an application from opening automatically when I start my Mac?',
  'Which data structure normally provides average O(1) lookup?',
  'Why does ice float on water?',
  'Write a Python function to reverse a linked list.',
];

describe('open-knowledge questions take the FAST path in every mode', () => {
  for (const q of OPEN_KNOWLEDGE_QUESTIONS) {
    for (const modeId of MODE_IDS) {
      test(`"${q.slice(0, 44)}…" [${modeId}]`, () => {
        const r = classify(q, modeId);
        assert.equal(r.path, 'FAST', `${r.reason} (types=${r.questionTypes} claims=${r.claimTypes})`);
        assert.equal(r.shouldRetrieve, false);
        assert.deepEqual(r.requiredSourceTypes, []);
        for (const s of IDENTITY_SOURCES) {
          assert.ok(!r.requiredSourceTypes.includes(s), `${s} must not be planned for: ${q}`);
        }
      });
    }
  }

  test('troubleshooting carries a general claim, not USER_EMPLOYMENT', () => {
    const r = classify('My laptop becomes very hot and the fans run loudly whenever I open Chrome. What should I check first?', 'looking-for-work');
    assert.ok(!r.claimTypes.includes('USER_EMPLOYMENT'), 'device ownership is not work history');
    assert.ok(r.claimTypes.includes('GENERAL_TECHNICAL'), 'must remain answerable (FULL), not AMBIGUOUS/NONE');
  });

  test('arithmetic carries a general claim, not USER_PROJECT/DOCUMENT_FACT', () => {
    const r = classify('A product costs 2,400 rupees after a 20% discount. What was the original price?', 'looking-for-work');
    assert.ok(!r.claimTypes.includes('USER_PROJECT'));
    assert.ok(!r.claimTypes.includes('DOCUMENT_FACT'));
    assert.ok(r.claimTypes.includes('GENERAL_TECHNICAL'));
  });
});

// ── guard rails: genuinely grounded questions must STAY grounded ────────────

describe('grounded questions are unchanged by the open-knowledge fixes', () => {
  test('personal history still requires the résumé', () => {
    const r = classify('Tell me about my experience at Aetherlab.', 'looking-for-work');
    assert.equal(r.shouldRetrieve, true);
    assert.ok(r.requiredSourceTypes.includes('RESUME'));
  });

  test('résumé-deictic skill check still grounds', () => {
    const r = classify('Does my resume show Kubernetes experience?', 'looking-for-work');
    assert.equal(r.shouldRetrieve, true);
    assert.ok(r.requiredSourceTypes.includes('RESUME'));
  });

  test('named-entity value lookup still grounds', () => {
    const r = classify('What is the discount floor for Acme?', 'sales');
    assert.equal(r.shouldRetrieve, true, r.reason);
  });

  test('instance-specific metric still grounds', () => {
    const r = classify('What is the peak transaction volume of the payments API?', 'seminar');
    assert.equal(r.shouldRetrieve, true, r.reason);
  });

  test('document-deictic price question is a document claim, never math', () => {
    const r = classify('What exact price is listed in the sales document?', 'sales');
    assert.ok(r.claimTypes.includes('DOCUMENT_FACT'), `claims=${r.claimTypes}`);
    assert.equal(r.shouldRetrieve, true);
  });

  test('"why does the <definite instance>" keeps its grounded route in a document mode', () => {
    const r = classify('Why does the deploy fail every night?', 'seminar');
    assert.equal(r.shouldRetrieve, true, r.reason);
  });

  test('permission/offer questions with percentages are NOT arithmetic', () => {
    // "can I offer a 20% discount" asks what the material authorizes — not a
    // computation. It must not take the math fast path.
    const r = classify('Can I offer a 20% discount to close the deal?', 'sales');
    assert.notEqual(r.path, 'FAST', r.reason);
  });

  test('strict source-only still verifies everything, including concepts', () => {
    const strict = { ...MODE_POLICIES.seminar, groundingPolicy: 'STRICT_SOURCE_ONLY' };
    const r = classifyTurn({
      resolvedQuestion: 'Explain why the sky appears blue to a 12-year-old.',
      policy: strict, isFollowUp: false,
    });
    assert.equal(r.path, 'VERIFICATION');
    assert.equal(r.shouldRetrieve, true);
  });
});

// ── follow-up resolver: self-contained turns are never rewritten ─────────────

describe('resolver never glues a referent onto a self-contained turn', () => {
  const scope = { meetingId: 'm-followup' };

  test('long self-contained support request after an MCQ stays byte-identical', () => {
    const state = advance(null, { scope, question: 'Which option is correct: Array or Hash map?' });
    const q = 'I paid for the subscription yesterday, but the application still shows the free plan. Please fix this immediately.';
    const ref = resolveReference(q, state);
    assert.equal(ref.resolved, q, `must not become "${ref.resolved}"`);
    assert.equal(ref.usedState, false);
    assert.equal(ref.reason, 'CURRENT_TURN_SELF_CONTAINED');
  });

  test('unrelated general question after a technical topic stays unchanged', () => {
    const state = advance(null, { scope, question: 'Explain React hooks.' });
    const q = 'Why does the sky appear blue?';
    const ref = resolveReference(q, state);
    assert.equal(ref.resolved, q);
    assert.equal(ref.usedState, false);
  });

  test('troubleshooting turn after a candidate fact stays unchanged', () => {
    const state = advance(null, { scope, question: 'The candidate worked at Google.' });
    const q = 'My laptop gets hot when I open Chrome. What should I check?';
    const ref = resolveReference(q, state);
    assert.equal(ref.resolved, q);
    assert.equal(ref.usedState, false);
  });

  test('"What is its worst-case complexity?" resolves against the previous turn', () => {
    const state = advance(null, { scope, question: 'A hash map normally provides average O(1) lookup.' });
    const ref = resolveReference('What is its worst-case complexity?', state);
    assert.equal(ref.usedState, true, 'a genuine short pronoun follow-up must resolve');
    assert.ok(ref.resolved.includes('hash map') || ref.resolved.includes('A hash map'),
      `referent must come from the previous turn, got: ${ref.resolved}`);
  });

  test('short pronoun follow-up still resolves to the active topic', () => {
    const state = advance(null, { scope, question: 'What does this lecture say about quantum computing?' });
    const ref = resolveReference('Can you explain it generally instead?', state);
    assert.equal(ref.usedState, true);
  });

  test('bare "Why not?" still anchors to the previous question', () => {
    const state = advance(null, { scope, question: 'Do I have Kubernetes experience?' });
    const ref = resolveReference('Why not?', state);
    assert.equal(ref.usedState, true);
  });
});
