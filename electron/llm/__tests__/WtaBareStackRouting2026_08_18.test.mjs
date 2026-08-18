// electron/llm/__tests__/WtaBareStackRouting2026_08_18.test.mjs
//
// WTA audit 2026-08-18 (.audit/wta-audit.md F1), measured on the compiled
// build: `"Why did you choose that stack?"` routed to `dsa_question_answer`
// (profile FORBIDDEN, answer rewritten by the six-section coding repair into
// an `O(?)` scaffold) while `"Why did you choose that technology?"` routed to
// `project_followup_answer` (profile required). Root cause: the bare
// `\bstack\b` entries in DSA_PATTERNS (answerPlannerPatterns.ts) and
// TECHNICAL_SUBJECT_PATTERNS are only neutralized for the literal phrases
// "tech/technology/technical stack", "full-stack" and "stack(s|ed) up" —
// a demonstrative/possessive reference ("that stack", "your stack") is
// unprotected, so the project-followup branch's DSA negation guard fails and
// the question falls through to the DSA branch.
//
// The same bare `\bstack\b` lives in IntentClassifier's DSA fast path, which
// classifies the identical question as coding @ hardcoded 0.95.
//
// These tests fail when either neutralizer is reverted (mutation tests for
// the F1 fix). Control cases pin that genuine data-structure usage keeps
// routing to DSA/coding.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);
const { classifyIntent } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/IntentClassifier.js')).href
);

const p = (q) => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer' });

describe('bare demonstrative/possessive "stack" is a tech-stack reference, not a DSA route', () => {
  for (const q of [
    'Why did you choose that stack?',
    'Why did you pick that stack for your notification system?',
    'Why did you choose this stack?',
    'Why did you choose your stack?',
    'Why did you use our stack?',
  ]) {
    test(`"${q}" → project_followup_answer, profile required`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'project_followup_answer', `got ${r.answerType}`);
      assert.equal(r.profileContextPolicy, 'required');
    });
  }

  test('"Why did you choose the stack?" (choice verb + "the stack") is not DSA', () => {
    const r = p('Why did you choose the stack?');
    assert.notEqual(r.answerType, 'dsa_question_answer', 'choice-verb "the stack" must not route to DSA');
  });
});

describe('genuine data-structure usage is unaffected (over-fix guards)', () => {
  test('"Implement a stack using two queues." still routes to a coding/DSA type', () => {
    const r = p('Implement a stack using two queues.');
    assert.ok(
      r.answerType === 'dsa_question_answer' || r.answerType === 'coding_question_answer',
      `got ${r.answerType}`
    );
  });

  test('"What is the difference between a stack and a queue?" still routes technically', () => {
    const r = p('What is the difference between a stack and a queue?');
    assert.ok(
      ['dsa_question_answer', 'technical_concept_answer', 'coding_question_answer'].includes(r.answerType),
      `got ${r.answerType}`
    );
  });
});

describe('IntentClassifier fast path no longer forces coding@0.95 on demonstrative "stack"', () => {
  test('the regex tier still fast-paths a genuine DSA stack question (control)', async () => {
    const r = await classifyIntent('can you implement a stack using two queues', '', 0);
    assert.equal(r.intent, 'coding');
    assert.equal(r.confidence, 0.95);
  });

  test('"Why did you choose that stack?" does not carry the regex tier\'s coding@0.95 signature', async () => {
    // Mirrors IntentClassifierStackUpIdiom2026_07_17: the private regex tier
    // returns coding at exactly 0.95; the SLM/context tiers never do. If the
    // demonstrative-stack neutralizer is reverted, this question re-acquires
    // that exact signature and this assertion fails.
    const r = await classifyIntent('Why did you choose that stack?', '', 0);
    assert.ok(
      !(r.intent === 'coding' && r.confidence === 0.95),
      `regex fast path misclassified as coding@0.95 (got ${r.intent}@${r.confidence})`
    );
  });
});
