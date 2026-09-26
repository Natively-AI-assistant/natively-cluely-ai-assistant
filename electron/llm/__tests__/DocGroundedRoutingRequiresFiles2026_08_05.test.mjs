// Regression test for PR #429 Bug 001: document-grounded refusals on general
// questions when the active mode's contract names reference files as the
// primary source but the user has uploaded NO files.
//
// Root cause: since the deliberate 2026-07-15 isolation fix,
// `documentGroundedCustomModeActive` is authority-only (true the moment a
// reference-files-primary mode is created, before any upload) so that
// Hindsight/OKF/profile isolation engages immediately. But AnswerPlanner's
// forced doc-shape ROUTING consumed the same flag, so a fresh Team-Meet /
// Lecture mode with zero files routed every general question into a
// doc-grounded answer shape, whose validator then refused against the empty
// evidence block ("I could not find that in the retrieved sections...").
//
// The fix splits the flag's two roles:
//  - ROUTING to doc answer shapes additionally requires
//    `activeMode.documentGrounded` (the guarded, files-required field computed
//    by documentGroundedFromContract in ModesManager).
//  - The ISOLATION role is untouched: plan.documentGroundedCustomModeActive
//    still propagates authority-only, so contextRoute's resume/JD suppression
//    and the Hindsight/OKF gates keep engaging before any upload.

// ─── RESOLVED 2026-08-16 ─────────────────────────────────────────────────────
// Bug 001 is fixed, and so is the second hole this file found: the policy line
// now additionally requires FILES, so a `reference_files_only` mode with nothing
// uploaded is no longer told to refuse against material that does not exist.
//
// The third axis originally asserted here — "suppression requires STRICT" — was
// NOT implemented, because it is false under R1. See the block comment above the
// second describe: it contradicted F9PurposeHonestyUnderR1_2026_08_15 on an
// identical plan, and R1 enforcement is what actually forces retrieval. Those
// two assertions were rewritten rather than satisfied.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planAnswer, buildContextRoute, formatAnswerPlanForPrompt } from '../../../dist-electron/electron/llm/index.js';
import { isDocGroundedAnswerType } from '../../../dist-electron/electron/llm/documentGroundedPrompt.js';

const baseMode = {
  id: 'mode-1',
  templateType: 'team_meet',
  name: 'Team Meet',
  isCustom: false,
  hasCustomPrompt: false,
  sourceContract: undefined,
};

const modeNoFiles = {
  ...baseMode,
  hasReferenceFiles: false,
  documentGrounded: false,               // guarded field: no files → false
  documentGroundedCustomModeActive: true, // authority-only isolation flag
};

const modeWithFiles = {
  ...baseMode,
  hasReferenceFiles: true,
  documentGrounded: true,
  documentGroundedCustomModeActive: true,
};

const generalQuestion = {
  question: 'What did that YouTube video say about the election results?',
  source: 'manual_input',
  speakerPerspective: 'user',
};

describe('Bug 001: doc-shape routing requires reference files', () => {
  test('general question + doc-grounded-intent mode with NO files → NOT routed to a doc answer shape', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: modeNoFiles });
    assert.ok(!isDocGroundedAnswerType(plan.answerType),
      `expected a non-doc answer type with no files uploaded, got: ${plan.answerType}`);
  });

  test('general question + doc-grounded mode WITH files → doc answer shape preserved', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: modeWithFiles });
    assert.ok(isDocGroundedAnswerType(plan.answerType),
      `doc-grounded routing with files present must be unchanged, got: ${plan.answerType}`);
  });

  test('isolation flag still propagates on the plan even with NO files (2026-07-15 invariant)', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: modeNoFiles });
    assert.equal(plan.documentGroundedCustomModeActive, true,
      'plan.documentGroundedCustomModeActive must stay authority-only — isolation must not lapse');
  });

  test('contextRoute keeps suppressing resume/jd off the isolation flag with NO files', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: modeNoFiles });
    const route = buildContextRoute(plan);
    const resume = route.layers.find((l) => l.layer === 'resume');
    const jd = route.layers.find((l) => l.layer === 'jd');
    assert.equal(resume?.selected, false, 'resume layer must stay suppressed pre-upload');
    assert.equal(jd?.selected, false, 'jd layer must stay suppressed pre-upload');
  });

  test('mode-blind turn (no activeMode) is unaffected', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: null });
    assert.ok(!isDocGroundedAnswerType(plan.answerType));
  });

  // Code-review follow-up (2026-08-05): the routing fix alone left a second
  // path to the same refusal — formatAnswerPlanForPrompt's policyLine keyed on
  // the raw authority-only flag, so a no-files turn still handed the model
  // "say plainly that the requested information is not in the uploaded
  // material" via the PROMPT even though the answer type was general.
  test('policy line does NOT instruct uploaded-material refusals with NO files', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: modeNoFiles });
    const formatted = formatAnswerPlanForPrompt(plan);
    assert.ok(!/not in the uploaded material/i.test(formatted),
      `no-files turn must not carry the uploaded-material refusal instruction, got: ${formatted}`);
  });

  test('policy line still instructs doc grounding WITH files', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: modeWithFiles });
    const formatted = formatAnswerPlanForPrompt(plan);
    assert.ok(/uploaded\/reference files/i.test(formatted),
      `files-present turn must keep the doc-grounding policy line, got: ${formatted}`);
  });
});

// Code-review 2026-08-13, REVISED 2026-08-16.
//
// This block was originally titled "SUPPRESSION requires strict", on the premise
// that a template-seeded (files-present, NOT strict) mode never forces retrieval
// and so must not be told to refuse on absence. That premise was superseded by
// the PR #466 adoption of main's R1 enforcement predicate, and these assertions
// were the last place still encoding it.
//
// Under R1, `docGroundedEnforcementActive` is what sets forceDocumentGrounding on
// the retrieval call (LLMHelper.ts:2299, IntelligenceEngine.ts:1179), and it IS
// true for a seeded, files-present, non-strict mode. Retrieval really is forced
// there, so the honesty mandate is honest — which is precisely what
// F9PurposeHonestyUnderR1_2026_08_15 pins, using this identical mode shape and
// asserting the OPPOSITE of what this block used to. Two tests demanding
// contradictory output from one plan cannot both stand, and the plans are in fact
// identical (same answerType, same enforcement/strict/files), so there is no
// discriminator to split them on. The newer, architecture-aligned one wins.
//
// The REAL hole this block found does survive, and is what it now pins:
// enforcement is ALSO true on the AUTHORITY ALONE — strictDocumentGroundedFromContract
// returns true for `reference_files_only` before anything is uploaded (its
// hasReferenceFiles check guards only the reference_files_primary/_plus_transcript
// branch). Such a mode was told to say the answer was "not in the uploaded
// material" when no uploaded material existed at all. Requiring FILES closes that
// and nothing else.
describe('doc-grounding SUPPRESSION requires FILES, not authority alone', () => {
  const templateSeededWithFiles = {
    ...modeWithFiles,
    strictDocumentGroundedActive: false, // origin === 'default_new_mode'
  };
  const explicitDocModeWithFiles = {
    ...modeWithFiles,
    strictDocumentGroundedActive: true, // user chose the authority, or reference_files_only
  };

  test('template-seeded mode + files: refusal IS instructed (R1 forces retrieval here)', () => {
    // Was asserted the other way until 2026-08-16. See the block comment: under
    // R1 this mode's retrieval is forced, so mandating honesty about absence is
    // honest rather than a licence to deny. Mirrors F9PurposeHonestyUnderR1.
    const plan = planAnswer({ ...generalQuestion, activeMode: templateSeededWithFiles });
    assert.equal(plan.docGroundedEnforcementActive, true,
      'precondition: seeded + files forces enforcement under R1');
    assert.equal(plan.documentGroundedFilesPresent, true, 'precondition: files are present');
    const formatted = formatAnswerPlanForPrompt(plan);
    assert.ok(/not in the uploaded material/i.test(formatted),
      `enforced turn must keep the honesty mandate, got: ${formatted}`);
  });

  test('template-seeded mode + files: still told to GROUND in the files', () => {
    // Dropping the whole line would be the opposite defect — the user attached
    // a file precisely so it would be used.
    const plan = planAnswer({ ...generalQuestion, activeMode: templateSeededWithFiles });
    const formatted = formatAnswerPlanForPrompt(plan);
    assert.ok(/uploaded\/reference files/i.test(formatted),
      `files-present turn must still ground in the files, got: ${formatted}`);
  });

  // Code-review 2026-08-14. The FIRST version of this fix gated the refusal on
  // `documentGroundedStrict` ALONE, which re-opened Bug 001 through a door the
  // original never used: strictDocumentGroundedFromContract returns true for
  // `reference_files_only` on the AUTHORITY ALONE — its hasReferenceFiles check
  // guards only the reference_files_primary/_plus_transcript branch. So a
  // "reference files only" mode with nothing uploaded yet, or whose last file
  // was deleted, had strict=true and filesPresent=false and was handed the
  // refusal instruction with no material behind it. Measured before the fix:
  // documentGroundedStrict=true, documentGroundedFilesPresent=false,
  // "not in the uploaded material" PRESENT.
  const referenceFilesOnlyNoFiles = {
    ...modeNoFiles,
    documentGroundedCustomModeActive: true,
    documentGrounded: false,          // no files → documentGroundedFromContract false
    hasReferenceFiles: false,
    strictDocumentGroundedActive: true, // reference_files_only: authority alone
  };

  test('reference_files_only with NO files: no uploaded-material refusal', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: referenceFilesOnlyNoFiles });
    assert.equal(plan.documentGroundedStrict, true, 'precondition: strict is true on authority alone');
    assert.equal(plan.documentGroundedFilesPresent, false, 'precondition: no files are present');
    const formatted = formatAnswerPlanForPrompt(plan);
    assert.ok(
      !/not in the uploaded material/i.test(formatted),
      `strict-but-fileless mode must not be told to refuse against material the user never provided, got: ${formatted}`,
    );
  });

  test('explicitly chosen doc mode + files: refusal instruction is PRESERVED', () => {
    const plan = planAnswer({ ...generalQuestion, activeMode: explicitDocModeWithFiles });
    const formatted = formatAnswerPlanForPrompt(plan);
    assert.ok(/not in the uploaded material/i.test(formatted),
      `strict mode must keep the suppression half, got: ${formatted}`);
    assert.ok(!/answer normally from general knowledge/i.test(formatted),
      'strict mode must NOT permit general-knowledge fallback');
  });
});
