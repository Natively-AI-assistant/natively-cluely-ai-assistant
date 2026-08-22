// electron/llm/__tests__/LengthCeiling2026_08_23.test.mjs
//
// Sessions D/E (2026-08-23): a band of 76–156-word answers sat above the
// usual size. Two delivery gaps in renderLengthDirectiveForPlan:
//   1. the "aim for" band was overshot ~50–100% live (124w against a 60w
//      band) — the directive now carries a hard-ceiling sentence (band max
//      × 1.25) the model can cut against;
//   2. tiers outside SPOKEN_SHORT (debugging/system-design shapes) emitted
//      NO length line at all — they now get the product's outer ceiling
//      (45s ≈ 130 words) instead of running unbounded.
// Coding types stay exempt: the contract's sections own their length.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { renderLengthDirectiveForPlan } = await import(dist('AnswerPlanner.js'));

const plan = (answerType, question) => ({ answerType, answerStyle: undefined, question });

describe('SPOKEN_SHORT bands carry a hard ceiling', () => {
  test('the 40–60 band gets a 75-word ceiling (live E-4 overshot it to 124w)', () => {
    const d = renderLengthDirectiveForPlan(plan('general_meeting_answer', 'What questions would you ask me?'));
    assert.match(d, /roughly 40 to 60 words/);
    assert.match(d, /Hard ceiling: never go past 75 words/);
  });

  test('every short band ceiling is band-max × 1.25', () => {
    const d = renderLengthDirectiveForPlan(plan('follow_up_answer', 'Okay, how would you split the system into services?'));
    const m = d.match(/roughly \d+ to (\d+) words[\s\S]*never go past (\d+) words/);
    assert.ok(m, d);
    assert.equal(Number(m[2]), Math.round(Number(m[1]) * 1.25));
  });
});

describe('tiers outside SPOKEN_SHORT get the outer ceiling instead of nothing', () => {
  test('debugging_question_answer (live D-15 had NO directive) now carries the 130-word ceiling', () => {
    const d = renderLengthDirectiveForPlan(plan('debugging_question_answer', 'How would you debug that?'));
    assert.notEqual(d, '', 'must not run unbounded');
    // Wording pinned to the live-A/B winner (155w -> 131w mean on the D-15
    // debugging question): cap-first, stop instruction, branch-level cutting.
    assert.match(d, /LENGTH LIMIT: at most 130 words/);
    assert.match(d, /a hard cap, not a target/);
    assert.match(d, /cut whole branches, not adjectives/);
    assert.match(d, /Only an explicit ask for code, a document, or a step-by-step walkthrough lifts the cap/);
  });
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
