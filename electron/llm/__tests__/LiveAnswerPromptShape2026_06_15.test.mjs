// electron/llm/__tests__/LiveAnswerPromptShape2026_06_15.test.mjs
//
// Regression tests for the "Live Moment Router / Cluely-prompt" audit (2026-06-15):
//
//   Fix A — the LIVE answer prompts must NOT mandate a Cluely "headline + bullets"
//           card. CUSTOM_ANSWER_PROMPT (live, via LLMHelper.mapToCustomPrompt) and
//           ANSWER_MODE_PROMPT (exported) previously ordered a "Short headline (<=6
//           words) / 1-2 main bullets" block, which contradicted
//           HUMAN_SPOKEN_ANSWER_CONTRACT and compressToSpeakable (strips scaffolds).
//           They must now FORBID a headline line / bullet list / headers unless the user
//           explicitly asks for structure.
//
//   Bold refinement (2026-06-15) — SPARING key-term **bold** is now ALLOWED (and
//           encouraged) in a spoken answer as an on-screen scanning aid so the user can
//           recreate the line at a glance. The deterministic bold-stripper in
//           humanizeSpokenAnswer was removed. The prompts must POSITIVELY permit bold of
//           a few key terms while still forbidding headline/bullets.
//
//   Fix B — technical_concept_answer must route correctly AND get the dedicated
//           TECHNICAL_CONCEPT_TEMPLATE (a short spoken interview answer), NOT the bare
//           GENERAL_TEMPLATE. Coding / behavioral / identity routing is unchanged.
//
// STRUCTURAL property assertions over compiled output — no fixed answers, no LLM, no
// network. Anti-hardcoding compliant.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as prompts from '../../../dist-electron/electron/llm/prompts.js';
import { planAnswer, formatAnswerPlanForPrompt } from '../../../dist-electron/electron/llm/AnswerPlanner.js';

// ── Fix A: live answer prompts forbid the headline/bullets card ───────────────
describe('Fix A — live answer prompts drop the Cluely headline+bullets mandate', () => {
  // The OLD positive instructions that must no longer appear as a mandate.
  const FORBIDDEN_MANDATES = ['Short headline', '1-2 main bullets', '1–2 main bullets', '≤6 words', 'main bullets'];
  const LIVE_AND_EXPORTED = ['CUSTOM_ANSWER_PROMPT', 'ANSWER_MODE_PROMPT'];

  for (const name of LIVE_AND_EXPORTED) {
    test(`${name} exists`, () => {
      assert.equal(typeof prompts[name], 'string');
      assert.ok(prompts[name].length > 100);
    });

    test(`${name} no longer mandates a headline / bullets card`, () => {
      const p = prompts[name];
      for (const bad of FORBIDDEN_MANDATES) {
        assert.ok(!p.includes(bad), `${name} must not contain the positive mandate "${bad}"`);
      }
    });

    test(`${name} now carries the speakable-prose negative instruction`, () => {
      const p = prompts[name];
      // "No headline line" / "NO headline line" + "no bullet list" / "NO bullet list".
      assert.match(p, /no\s+headline\s+line/i, `${name} must forbid a headline line`);
      assert.match(p, /no\s+bullet\s+list/i, `${name} must forbid a bullet list`);
      // And it must scope the exception to an EXPLICIT user request for structure.
      assert.match(p, /unless\s+the\s+user\s+(?:explicitly\s+)?asks/i, `${name} must allow structure only on explicit request`);
    });

    test(`${name} permits SPARING key-term bold (scanning aid), not forbids it`, () => {
      const p = prompts[name];
      // It must NOT carry the old blanket ban "no mid-sentence **bold**".
      assert.doesNotMatch(p, /no\s+mid-sentence\s+\*\*bold\*\*/i, `${name} must not blanket-ban mid-sentence bold anymore`);
      // It must POSITIVELY allow bolding a few key terms.
      assert.match(p, /\*\*bold\*\*/i, `${name} must mention **bold**`);
      assert.match(p, /key\s+terms?/i, `${name} must reference key terms`);
      assert.match(p, /(?:sparing|spar\w*|1-3|few terms|never\s+whole\s+phrases)/i, `${name} must cap bold to a sparing few terms`);
      assert.match(p, /recreate the line|at a glance|off-screen/i, `${name} must state the scanning-aid rationale`);
    });
  }

  test('CUSTOM_ANSWER_PROMPT is the LIVE custom-provider answer prompt (mapped)', () => {
    // Sanity: it identifies as the live meeting copilot answer prompt, not a notes card.
    assert.match(prompts.CUSTOM_ANSWER_PROMPT, /first[- ]person\s+prose/i);
  });
});

// ── Fix B: technical_concept routing + dedicated template ─────────────────────
const plan = (question, source = 'manual_input') => planAnswer({ question, source });
const GENERAL_BARE = 'Answer naturally and directly. Use only relevant context. Keep it predictable and concise.';

describe('Fix B — technical_concept_answer routing', () => {
  const CONCEPT_QS = [
    'What is Redis?',
    'Explain JWT.',
    'What is CORS?',
    'Explain caching.',
    'What is REST?',
    'What is a deadlock?',
  ];
  for (const q of CONCEPT_QS) {
    test(`${JSON.stringify(q)} → technical_concept_answer`, () => {
      assert.equal(plan(q).answerType, 'technical_concept_answer');
    });
  }
});

describe('Fix B — technical_concept gets the dedicated template (not bare GENERAL)', () => {
  const p = plan('What is Redis?');

  test('responseTemplate is the TECHNICAL_CONCEPT_TEMPLATE, not bare GENERAL_TEMPLATE', () => {
    assert.notEqual(p.responseTemplate, GENERAL_BARE);
    assert.match(p.responseTemplate, /SPOKEN ANSWER|spoken answer/i);
  });

  test('template leads with a plain one-line definition, woven into prose', () => {
    assert.match(p.responseTemplate, /one-line definition/i);
    assert.match(p.responseTemplate, /woven into prose|one short paragraph/i);
  });

  test('template bluntly forbids doc structure (headings / bullets / code blocks)', () => {
    assert.match(p.responseTemplate, /heading/i);
    assert.match(p.responseTemplate, /bullet/i);
    assert.match(p.responseTemplate, /code block/i);
    assert.match(p.responseTemplate, /WRONG/);
  });

  test('formatAnswerPlanForPrompt embeds the technical-concept template text', () => {
    const formatted = formatAnswerPlanForPrompt(p);
    assert.match(formatted, /SPOKEN ANSWER|spoken answer/i);
    assert.match(formatted, /answerType: technical_concept_answer/);
  });
});

describe('Fix B — no routing regression for coding / behavioral / identity', () => {
  const UNCHANGED = [
    ['Write a function to reverse a linked list', 'dsa_question_answer'],
    ['Solve two sum', 'dsa_question_answer'],
    ['Tell me about a time you led a team', 'behavioral_interview_answer'],
    ['Who are you?', 'identity_answer'],
    ['Why should we hire you?', 'jd_fit_answer'],
  ];
  for (const [q, expected] of UNCHANGED) {
    test(`${JSON.stringify(q)} → ${expected} (unchanged)`, () => {
      assert.equal(plan(q).answerType, expected);
    });
  }

  test('coding answer types still get a coding template (not technical-concept)', () => {
    const cp = plan('Write a function to reverse a linked list');
    assert.doesNotMatch(cp.responseTemplate, /THIS IS A SPOKEN ANSWER/);
  });
});
