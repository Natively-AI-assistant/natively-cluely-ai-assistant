// electron/llm/__tests__/F9PurposeHonestyUnderR1_2026_08_15.test.mjs
//
// F9's PURPOSE, pinned against the R1 system that superseded its code.
//
// History: code-review finding F9 (2026-08-14) fixed a policy line that told
// the model "answer normally from general knowledge — do NOT tell the user
// the information is missing from the uploaded material" — for a seeded
// doc-mode with files whose retrieval missed, that banned honesty outright
// and pushed the model to fabricate document contents. The PR #466 merge
// adopted main's R1 enforcement predicate instead, and F9's branch was pruned
// as DISSOLVED: under R1, seeded-mode+files forces retrieval AND the
// enforcement grounding line itself mandates honesty. This suite pins that
// dissolution so it stays true — if a future change reintroduces a
// files-present-but-unenforced prompt path, or re-adds honesty-banning
// wording, F9's failure mode reopens and this file goes red.
//
// Run with:
//   npm run build:electron
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/llm/__tests__/F9PurposeHonestyUnderR1_2026_08_15.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planAnswer, formatAnswerPlanForPrompt } from '../../../dist-electron/electron/llm/index.js';

const mode = (o) => ({ id: 'm', name: 'M', isCustom: false, hasCustomPrompt: false, ...o });

// The exact F9 scenario: template-seeded (NOT strict) doc mode, file attached,
// question asks specifically what the uploaded document says.
const SEEDED_WITH_FILES = mode({
  templateType: 'lecture', hasReferenceFiles: true, documentGrounded: true,
  documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
});
const SEEDED_NO_FILES = mode({
  templateType: 'lecture', hasReferenceFiles: false, documentGrounded: false,
  documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
});

const DOC_CONTENT_QUESTION = {
  question: 'What does section 5 of my thesis conclude?',
  source: 'manual_input',
  speakerPerspective: 'user',
};

const HONESTY_MANDATE = /say plainly that the requested information is not in the uploaded material/;
const HONESTY_BAN = /do not tell the user the information is missing/i;
const REFUSAL_SURFACE = /not in the uploaded material/;

describe('F9 purpose under R1: honesty is mandated exactly where refusal is honest', () => {
  test('seeded mode WITH files: enforcement is active and the prompt MANDATES honesty on absence', () => {
    const plan = planAnswer({ ...DOC_CONTENT_QUESTION, activeMode: SEEDED_WITH_FILES });
    assert.equal(plan.docGroundedEnforcementActive, true,
      'R1: seeded+files must force enforcement — this is the premise that dissolved F9');
    const prompt = formatAnswerPlanForPrompt(plan);
    assert.match(prompt, HONESTY_MANDATE,
      'the enforcement grounding line must instruct the model to say plainly when material is absent');
  });

  test('NO prompt path may ban honesty about missing material (the F9 wording itself)', () => {
    // Sweep every mode shape × the doc-content question: the F9-vulnerable
    // instruction must not exist anywhere in the assembled plan prompt.
    for (const m of [SEEDED_WITH_FILES, SEEDED_NO_FILES, mode({}), mode({ strictDocumentGroundedActive: true, documentGroundedCustomModeActive: true, hasReferenceFiles: true, documentGrounded: true })]) {
      const prompt = formatAnswerPlanForPrompt(planAnswer({ ...DOC_CONTENT_QUESTION, activeMode: m }));
      assert.doesNotMatch(prompt, HONESTY_BAN,
        'no plan may instruct the model to hide that information is missing from the uploaded material');
    }
  });

  test('seeded mode WITHOUT files: no refusal surface at all (Bug 001 stays closed)', () => {
    const plan = planAnswer({ ...DOC_CONTENT_QUESTION, activeMode: SEEDED_NO_FILES });
    assert.equal(plan.docGroundedEnforcementActive, false,
      'fileless seeded modes must not be enforced — a bounded universe does not exist');
    const prompt = formatAnswerPlanForPrompt(plan);
    assert.doesNotMatch(prompt, REFUSAL_SURFACE,
      'with nothing uploaded, the prompt must not tell the model to refuse against uploaded material');
  });
});
