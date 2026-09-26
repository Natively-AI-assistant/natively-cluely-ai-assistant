// electron/llm/__tests__/LengthCeiling2026_08_23.test.mjs
//
// Sessions D/E (2026-08-23) + code-review corrections (same day): the length
// directive is TIER-CORRECT —
//   - SPOKEN_SHORT: band + hard ceiling min(band-max x1.25, HARD_MAX_WORDS),
//     so the prompt can never instruct the model into the range speakability
//     telemetry classifies over_budget (85x1.25=106 crossed the 100 line);
//   - SPOKEN_FULL (STAR stories, multi-part): capped at SPOKEN_FULL_MAX_WORDS
//     (180), the tier's own budget — not the 130 outer cap that contradicted it;
//   - STRUCTURED_FULL (debugging/system-design/lecture/evidence, explicit
//     step-by-step asks): NO directive — speakability.ts says these "must
//     never be length-trimmed", and the first ceiling draft self-contradicted
//     on exactly the walkthrough questions that select the tier;
//   - coding types and explicit answerStyles stay exempt.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { renderLengthDirectiveForPlan } = await import(dist('AnswerPlanner.js'));
const { HARD_MAX_WORDS, SPOKEN_FULL_MAX_WORDS } = await import(dist('speakability.js'));

const plan = (answerType, question) => ({ answerType, answerStyle: undefined, question });

describe('SPOKEN_SHORT bands carry a clamped hard ceiling', () => {
  test('the 40-60 band gets a 75-word ceiling (live E-4 overshot it to 124w)', () => {
    const d = renderLengthDirectiveForPlan(plan('general_meeting_answer', 'What questions would you ask me?'));
    assert.match(d, /roughly 40 to 60 words/);
    assert.match(d, /Hard ceiling: never go past 75 words/);
  });

  test('no short-band ceiling ever exceeds HARD_MAX_WORDS (review: 85x1.25=106 crossed 100)', () => {
    for (const [type, q] of [
      ['follow_up_answer', 'Okay, how would you split the system into services?'],
      ['general_meeting_answer', 'So when would you use an atomic?'],
      ['technical_concept_answer', "Want to persist a session, let's start simple: how would you design this?"],
    ]) {
      const d = renderLengthDirectiveForPlan(plan(type, q));
      if (!d || !/Hard ceiling/.test(d)) continue;
      const m = d.match(/never go past (\d+) words/);
      assert.ok(m, d);
      assert.ok(Number(m[1]) <= HARD_MAX_WORDS, `${type}: ceiling ${m[1]} > HARD_MAX_WORDS ${HARD_MAX_WORDS}`);
    }
  });
});

describe('SPOKEN_FULL gets its own budget, never the outer cap', () => {
  test('a behavioral STAR story is capped at SPOKEN_FULL_MAX_WORDS, not 130', () => {
    const d = renderLengthDirectiveForPlan(plan('behavioral_interview_answer', 'Tell me about a time you disagreed with your manager.'));
    assert.match(d, new RegExp(`at most ${SPOKEN_FULL_MAX_WORDS} words`));
    assert.doesNotMatch(d, /130 words/);
    assert.match(d, /a hard cap, not a target/);
  });
});

describe('STRUCTURED_FULL is intentionally uncapped (module contract)', () => {
  for (const [type, q, label] of [
    ['debugging_question_answer', 'How would you debug that?', 'debugging'],
    ['system_design_answer', 'Design a rate limiter.', 'system design'],
    ['lecture_answer', 'Summarize the chapter.', 'lecture'],
    ['source_code_evidence_answer', 'Show me where the retry logic lives.', 'evidence'],
    ['general_meeting_answer', 'Can you walk me through the auth flow step by step?', 'explicit step-by-step ask'],
  ]) {
    test(`${label}: no length directive`, () => {
      assert.equal(renderLengthDirectiveForPlan(plan(type, q)), '',
        'speakability.ts: structured-full output "must never be length-trimmed"');
    });
  }
});

describe('exemptions preserved', () => {
  test('coding types emit no length line (the contract owns it)', () => {
    assert.equal(renderLengthDirectiveForPlan(plan('coding_question_answer', 'Solve two sum.')), '');
    assert.equal(renderLengthDirectiveForPlan(plan('dsa_question_answer', 'Reverse a linked list.')), '');
  });

  test('an explicit answerStyle still owns its own length', () => {
    assert.equal(renderLengthDirectiveForPlan({ answerType: 'general_meeting_answer', answerStyle: 'bullet_list', question: 'List the steps.' }), '');
  });
});
