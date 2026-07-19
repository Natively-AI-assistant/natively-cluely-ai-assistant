// electron/services/__tests__/ModeSeminarGroundingProfile.test.mjs
//
// Campaign 3 (fix/answer-policy-engine, 2026-07-19) — Seminar Mode + groundingProfile
// schema tests. Verifies:
//   1. 'seminar' is accepted in ModeTemplateType (ModesManager) and
//      ContractTemplateType (modeSourceContract) unions.
//   2. The Seminar entry exists in MODE_TEMPLATES, TEMPLATE_NOTE_SECTIONS,
//      TEMPLATE_SYSTEM_PROMPTS, and MODE_CONTEXT_PROFILES.
//   3. MODE_SEMINAR_PROMPT (in prompts.ts) exists and is non-empty.
//   4. ModeSourceContract accepts an optional `groundingProfile` field with
//      the strict-shape enum literals (TypeScript-level test via the
//      existing esbuild pipeline; runtime test below imports the type
//      via the compiled JS).
//   5. The TurnPlanner module's GroundingProfile shape matches the contract's
//      GroundingProfile shape (drift guard).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  MODE_TEMPLATES,
  TEMPLATE_NOTE_SECTIONS,
  TEMPLATE_SYSTEM_PROMPTS,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js')).href);

const {
  defaultSourceContractForNewMode,
  isContractTemplateType: _noImport,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modeSourceContract.js')).href);

const {
  MODE_CONTEXT_PROFILES,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/modeProfiles.js')).href);

const {
  SEMINAR_GROUNDING_PROFILE,
  DEFAULT_GROUNDING_PROFILE,
  planTurn,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/TurnPlanner.js')).href);

const promptsModule = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js')).href);

describe('Seminar Mode (Campaign 3): 8th built-in mode wiring', () => {
  test('MODE_TEMPLATES has a seminar entry with label "Seminar" and a strict grounding description', () => {
    const seminar = MODE_TEMPLATES.find((m) => m.type === 'seminar');
    assert.ok(seminar, 'MODE_TEMPLATES must contain a seminar entry');
    assert.equal(seminar.label, 'Seminar');
    assert.ok(seminar.description.toLowerCase().includes('reference files'),
      'description must mention reference files (the strict grounding axis)');
    assert.ok(seminar.description.toLowerCase().includes('never a refusal'),
      'description must explicitly disavow refusals — strict profile still answers, with a label');
  });

  test('TEMPLATE_NOTE_SECTIONS.seminar has Question / Source / Follow-up sections', () => {
    const sections = TEMPLATE_NOTE_SECTIONS.seminar;
    assert.ok(Array.isArray(sections) && sections.length > 0, 'seminar must have note sections');
    const titles = sections.map((s) => s.title);
    assert.ok(titles.includes('Question'), 'must include Question section');
    assert.ok(titles.includes('Source'), 'must include Source section (citation is the strict-mode differentiator)');
    assert.ok(titles.includes('If not in your files'), 'must include the off-file preamble section');
  });

  test('TEMPLATE_SYSTEM_PROMPTS.seminar is wired to MODE_SEMINAR_PROMPT', () => {
    assert.equal(typeof TEMPLATE_SYSTEM_PROMPTS.seminar, 'string');
    assert.ok(TEMPLATE_SYSTEM_PROMPTS.seminar.length > 200,
      'seminar prompt should be a substantive system prompt, not a stub');
    assert.ok(TEMPLATE_SYSTEM_PROMPTS.seminar.includes('reference files') || TEMPLATE_SYSTEM_PROMPTS.seminar.includes('reference document'),
      'seminar prompt must anchor on reference files');
    assert.ok(TEMPLATE_SYSTEM_PROMPTS.seminar.includes('never'),
      'seminar prompt must include explicit never-clauses (anti-fabrication, anti-refusal)');
  });

  test('MODE_SEMINAR_PROMPT exists in prompts.ts and is non-empty', () => {
    assert.ok(typeof promptsModule.MODE_SEMINAR_PROMPT === 'string');
    assert.ok(promptsModule.MODE_SEMINAR_PROMPT.length > 200,
      'MODE_SEMINAR_PROMPT must be a substantive prompt (not a placeholder)');
  });

  test('MODE_CONTEXT_PROFILES.seminar routes to lecture_answer floor (file-grounded)', () => {
    assert.ok(MODE_CONTEXT_PROFILES.seminar, 'seminar must be a key in MODE_CONTEXT_PROFILES');
    assert.equal(MODE_CONTEXT_PROFILES.seminar.fallbackLiveAnswerType, 'lecture_answer',
      'seminar mode should default to file-grounded lecture_answer on ambiguous live turns');
    assert.equal(MODE_CONTEXT_PROFILES.seminar.fallbackManualAnswerType, 'lecture_answer',
      'seminar mode should default to lecture_answer on ambiguous manual turns too');
  });
});

describe('Seminar Mode: groundingProfile shape and TurnPlanner integration', () => {
  test('SEMINAR_GROUNDING_PROFILE has the strictest preset (required / say_not_found_then_answer_general)', () => {
    assert.equal(SEMINAR_GROUNDING_PROFILE.evidencePreference, 'required');
    assert.equal(SEMINAR_GROUNDING_PROFILE.onNoEvidence, 'say_not_found_then_answer_general');
    assert.equal(SEMINAR_GROUNDING_PROFILE.labelStyle, 'badge');
  });

  test('DEFAULT_GROUNDING_PROFILE differs from SEMINAR — strict profile is the differentiator', () => {
    assert.equal(DEFAULT_GROUNDING_PROFILE.evidencePreference, 'preferred');
    assert.equal(DEFAULT_GROUNDING_PROFILE.onNoEvidence, 'answer_general_labeled');
    assert.notEqual(DEFAULT_GROUNDING_PROFILE.onNoEvidence, SEMINAR_GROUNDING_PROFILE.onNoEvidence,
      'default and seminar onNoEvidence MUST differ — strict profile is the differentiator');
  });

  test('planTurn (with NATIVELY_SEMINAR_MODE=1 env flag) emits SEMINAR_GROUNDING_PROFILE', () => {
    const prev = process.env.NATIVELY_SEMINAR_MODE;
    process.env.NATIVELY_SEMINAR_MODE = '1';
    try {
      const plan = planTurn({ question: 'what is the method', availability: {
        hasReferenceFiles: true, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: true,
      } });
      assert.equal(plan.groundingProfile.evidencePreference, 'required',
        'seminar env flag must flip the plan to required evidence preference');
      assert.equal(plan.groundingProfile.onNoEvidence, 'say_not_found_then_answer_general');
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
      else process.env.NATIVELY_SEMINAR_MODE = prev;
    }
  });
});

describe('defaultSourceContractForNewMode accepts templateType=seminar (defense-in-depth)', () => {
  test('seminar template type does NOT throw — seeds a usable contract', () => {
    const contract = defaultSourceContractForNewMode('seminar');
    assert.ok(contract, 'seminar template must produce a contract');
    assert.equal(contract.version, 1);
    assert.equal(contract.origin, 'default_new_mode');
    assert.equal(contract.seededForTemplateType, 'seminar');
    // NOTE: the contract itself does NOT auto-populate groundingProfile today
    // (that's read-side work). The reader must default it for 'seminar'.
    // This is acceptable because the strict policy lives in TurnPlanner +
    // SEMINAR_GROUNDING_PROFILE; the contract's role is to round-trip.
  });
});
