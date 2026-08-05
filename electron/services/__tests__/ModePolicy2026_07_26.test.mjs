// electron/services/__tests__/ModePolicy2026_07_26.test.mjs
//
// Phase 6 (context-rebuild) — `ModePolicy` (04_TARGET_ARCHITECTURE.md §2),
// the missing foundation Slice 7's items 2/3 (memoryReadPolicy's rewire to
// CanonicalTurn/ModePolicy) were blocked on. BUILT STANDALONE, NOT WIRED
// anywhere — see electron/services/modePolicy.ts's header for the full
// rationale (mirrors the promptComposer.ts/questionNeed.ts precedent).
//
// resolveModePolicy is spec'd as "pure projection — no retrieval, no LLM
// call" over modeSourceContract.ts + a mode-config object. These tests
// exercise the REAL compiled function against every ModeSourceAuthority
// value, confirm the groundingProfile resolution order matches
// TurnPlanner.groundingProfileFor's own precedence exactly (explicit
// contract override → seminar templateType → default), and confirm
// documentGroundedCustomModeActive delegates to the real
// documentGroundedFromContract (not reimplemented).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { resolveModePolicy } = require(
  path.resolve(repoRoot, 'dist-electron/electron/services/modePolicy.js'),
);
const { defaultSourceContractForNewMode } = require(
  path.resolve(repoRoot, 'dist-electron/electron/services/modeSourceContract.js'),
);
const { DEFAULT_GROUNDING_PROFILE, SEMINAR_GROUNDING_PROFILE } = require(
  path.resolve(repoRoot, 'dist-electron/electron/llm/TurnPlanner.js'),
);

function makeContract(overrides = {}) {
  return {
    version: 1,
    defaultOwner: 'profile',
    allowedExplicitSwitches: [],
    sourceAuthority: 'profile_only',
    evidenceRequired: false,
    conflictPolicy: 'profile_wins',
    memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: true },
    ...overrides,
  };
}

function makeMode(overrides = {}) {
  return { id: 'mode-1', name: 'Looking for Work', isCustom: false, ...overrides };
}

describe('resolveModePolicy — basic field passthrough', () => {
  test('modeId/modeName/isCustomMode/sourceAuthority/allowedExplicitSwitches pass through unchanged', () => {
    const contract = makeContract({ sourceAuthority: 'profile_only', allowedExplicitSwitches: ['reference_files'] });
    const mode = makeMode({ id: 'm42', name: 'Sales', isCustom: true });
    const policy = resolveModePolicy(contract, mode);
    assert.equal(policy.modeId, 'm42');
    assert.equal(policy.modeName, 'Sales');
    assert.equal(policy.isCustomMode, true);
    assert.equal(policy.sourceAuthority, 'profile_only');
    assert.deepEqual(policy.allowedExplicitSwitches, ['reference_files']);
  });

  test('personaPrompt passes through when present, undefined when absent', () => {
    const contract = makeContract();
    assert.equal(resolveModePolicy(contract, makeMode({ personaPrompt: 'You are a sales coach.' })).personaPrompt, 'You are a sales coach.');
    assert.equal(resolveModePolicy(contract, makeMode()).personaPrompt, undefined);
  });
});

describe('resolveModePolicy — allowedSourceKinds coarse allow-list per sourceAuthority', () => {
  test('reference_files_only allows ONLY reference-file kinds, never profile kinds', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_only' }), makeMode());
    assert.ok(policy.allowedSourceKinds.includes('mode_reference_file'));
    assert.ok(!policy.allowedSourceKinds.includes('profile_resume'), 'reference_files_only must never allow profile_resume — the exact PII-isolation invariant this whole slice protects');
    assert.ok(!policy.allowedSourceKinds.includes('profile_jd'));
  });

  test('profile_only allows ONLY profile-family kinds, never reference-file kinds', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'profile_only' }), makeMode());
    assert.ok(policy.allowedSourceKinds.includes('profile_resume'));
    assert.ok(!policy.allowedSourceKinds.includes('mode_reference_file'));
  });

  test('transcript_only allows ONLY transcript kinds', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'transcript_only' }), makeMode());
    assert.deepEqual([...policy.allowedSourceKinds].sort(), ['live_transcript', 'meeting_rag_chunk']);
  });

  test('general_mixed allows the full union (profile + reference + transcript)', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'general_mixed' }), makeMode());
    assert.ok(policy.allowedSourceKinds.includes('profile_resume'));
    assert.ok(policy.allowedSourceKinds.includes('mode_reference_file'));
    assert.ok(policy.allowedSourceKinds.includes('live_transcript'));
  });

  test('every ModeSourceAuthority value produces a non-empty allow-list (exhaustiveness — no silent fallthrough to undefined)', () => {
    const allAuthorities = [
      'reference_files_only', 'reference_files_primary', 'reference_files_plus_transcript',
      'profile_only', 'profile_plus_transcript', 'transcript_only', 'general_mixed', 'ask_if_ambiguous',
    ];
    for (const sourceAuthority of allAuthorities) {
      const policy = resolveModePolicy(makeContract({ sourceAuthority }), makeMode());
      assert.ok(Array.isArray(policy.allowedSourceKinds) && policy.allowedSourceKinds.length > 0, `${sourceAuthority} must produce a non-empty allow-list`);
    }
  });
});

describe('resolveModePolicy — generalKnowledgeAllowed', () => {
  test('false for reference_files_only and transcript_only (strict-isolation authorities)', () => {
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_only' }), makeMode()).generalKnowledgeAllowed, false);
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'transcript_only' }), makeMode()).generalKnowledgeAllowed, false);
  });

  test('true for profile_only, general_mixed, and other non-strict authorities', () => {
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'profile_only' }), makeMode()).generalKnowledgeAllowed, true);
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'general_mixed' }), makeMode()).generalKnowledgeAllowed, true);
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_primary' }), makeMode()).generalKnowledgeAllowed, true);
  });
});

describe('resolveModePolicy — referenceOnly', () => {
  test('true only for reference_files_only, false for every other authority', () => {
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_only' }), makeMode()).referenceOnly, true);
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_primary' }), makeMode()).referenceOnly, false);
    assert.equal(resolveModePolicy(makeContract({ sourceAuthority: 'profile_only' }), makeMode()).referenceOnly, false);
  });
});

describe('resolveModePolicy — documentGroundedCustomModeActive delegates to the REAL documentGroundedFromContract (not reimplemented)', () => {
  test('true when sourceAuthority is reference_files_only/_primary/_plus_transcript AND hasReferenceFiles', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_only' }), makeMode({ hasReferenceFiles: true }));
    assert.equal(policy.documentGroundedCustomModeActive, true);
  });

  test('false when hasReferenceFiles is false, even for a reference_files_only authority', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'reference_files_only' }), makeMode({ hasReferenceFiles: false }));
    assert.equal(policy.documentGroundedCustomModeActive, false);
  });

  test('false for profile_only regardless of hasReferenceFiles', () => {
    const policy = resolveModePolicy(makeContract({ sourceAuthority: 'profile_only' }), makeMode({ hasReferenceFiles: true }));
    assert.equal(policy.documentGroundedCustomModeActive, false);
  });
});

describe('resolveModePolicy — groundingProfile resolution order matches TurnPlanner.groundingProfileFor exactly', () => {
  test('1. explicit contract.groundingProfile wins over everything, including a seminar templateType', () => {
    const explicit = { evidencePreference: 'optional', onNoEvidence: 'refuse', labelStyle: 'paragraph' };
    const policy = resolveModePolicy(
      makeContract({ groundingProfile: explicit }),
      makeMode({ templateType: 'seminar' }),
    );
    assert.deepEqual(policy.groundingProfile, explicit);
  });

  test('2. mode.templateType === "seminar" (no explicit override) yields SEMINAR_GROUNDING_PROFILE', () => {
    const policy = resolveModePolicy(makeContract(), makeMode({ templateType: 'seminar' }));
    assert.deepEqual(policy.groundingProfile, SEMINAR_GROUNDING_PROFILE);
  });

  test('3. no override, no seminar template → DEFAULT_GROUNDING_PROFILE', () => {
    const policy = resolveModePolicy(makeContract(), makeMode({ templateType: 'looking-for-work' }));
    assert.deepEqual(policy.groundingProfile, DEFAULT_GROUNDING_PROFILE);
  });

  test('no templateType at all still falls back to DEFAULT_GROUNDING_PROFILE (no throw)', () => {
    const policy = resolveModePolicy(makeContract(), makeMode());
    assert.deepEqual(policy.groundingProfile, DEFAULT_GROUNDING_PROFILE);
  });
});

describe('resolveModePolicy against REAL default contracts for every built-in mode template (integration, not hand-built fixtures)', () => {
  const BUILT_IN_TEMPLATES = [
    'general', 'sales', 'recruiting', 'team-meet', 'lecture',
    'looking-for-work', 'technical-interview', 'seminar',
  ];

  test('every built-in template produces a policy with a non-empty allow-list and no throw', () => {
    for (const templateType of BUILT_IN_TEMPLATES) {
      const contract = defaultSourceContractForNewMode(templateType);
      const policy = resolveModePolicy(contract, { id: 'm', name: templateType, isCustom: false, templateType });
      assert.ok(policy.allowedSourceKinds.length > 0, `${templateType} must produce a non-empty allow-list`);
    }
  });

  test('looking-for-work and technical-interview (interview-prep templates) resolve to profile_only, generalKnowledgeAllowed=true, referenceOnly=false', () => {
    for (const templateType of ['looking-for-work', 'technical-interview']) {
      const contract = defaultSourceContractForNewMode(templateType);
      const policy = resolveModePolicy(contract, { id: 'm', name: templateType, isCustom: false, templateType });
      assert.equal(policy.sourceAuthority, 'profile_only', `${templateType} must default to profile_only`);
      assert.equal(policy.generalKnowledgeAllowed, true);
      assert.equal(policy.referenceOnly, false);
      assert.ok(policy.allowedSourceKinds.includes('profile_resume'));
      assert.ok(!policy.allowedSourceKinds.includes('mode_reference_file'));
    }
  });

  test('general/sales/recruiting/team-meet/lecture (document-grounded-by-default templates) resolve to reference_files_primary', () => {
    for (const templateType of ['general', 'sales', 'recruiting', 'team-meet', 'lecture']) {
      const contract = defaultSourceContractForNewMode(templateType);
      const policy = resolveModePolicy(contract, { id: 'm', name: templateType, isCustom: false, templateType });
      assert.equal(policy.sourceAuthority, 'reference_files_primary', `${templateType} must default to reference_files_primary`);
    }
  });

  test('seminar template gets SEMINAR_GROUNDING_PROFILE via the templateType branch (its default contract has no explicit groundingProfile override)', () => {
    const contract = defaultSourceContractForNewMode('seminar');
    assert.equal(contract.groundingProfile, undefined, 'precondition: the default seed contract has no explicit override, so this exercises the templateType branch specifically');
    const policy = resolveModePolicy(contract, { id: 'm', name: 'Seminar', isCustom: false, templateType: 'seminar' });
    assert.deepEqual(policy.groundingProfile, SEMINAR_GROUNDING_PROFILE);
  });
});

describe('resolveModePolicy is a pure function — same inputs, same output, no side effects', () => {
  test('calling twice with identical inputs produces deepEqual results', () => {
    const contract = makeContract({ sourceAuthority: 'reference_files_plus_transcript' });
    const mode = makeMode({ hasReferenceFiles: true, templateType: 'seminar' });
    const first = resolveModePolicy(contract, mode);
    const second = resolveModePolicy(contract, mode);
    assert.deepEqual(first, second);
  });
});
