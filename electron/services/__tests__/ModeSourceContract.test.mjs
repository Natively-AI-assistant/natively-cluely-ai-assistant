// Real-custom-mode-repair (2026-07-11) — unit tests for the new persisted
// ModeSourceContract module (electron/services/modeSourceContract.ts).
//
// These are the tests that would have caught the P0 contamination incident:
// a mode with reference files whose prompt is written in plausible real-user
// English (not regex-engineered) must NEVER migrate to `general_mixed`
// (everything allowed) — see docs/context-os/real-custom-mode-repair/
// 02_SYNTHETIC_VS_REAL_PATH.md and 06_ROOT_CAUSE_REPORT.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modeSourceContract.js');
const mod = await import(pathToFileURL(modPath).href);

const {
  defaultSourceContractForNewMode,
  buildUserSelectedSourceContract,
  migrateSourceContractFromPrompt,
  legacyPromptDetectsStrictDocumentGrounding,
  serializeModeSourceContract,
  parseModeSourceContract,
  documentGroundedFromContract,
} = mod;

// ── Realistic real-user phrasings that must NOT satisfy the strict legacy
//    regex pair (this is exactly what a real human writes, unlike the
//    regex-engineered synthetic E2E fixture strings) ────────────────────────
const REALISTIC_NON_STRICT_PHRASINGS = [
  'This is a seminar mode. I am presenting my thesis on AgenticVLA. Help me confidently answer questions about my thesis and my project.',
  'You are helping me prepare for my thesis defense. Everything you say should come from my thesis.',
  'I am giving a seminar presentation on my thesis project. Answer questions using the thesis I uploaded, and speak in first person as if you are me.',
];

test('legacyPromptDetectsStrictDocumentGrounding: realistic real-user phrasing fails the old strict regex pair', () => {
  for (const prompt of REALISTIC_NON_STRICT_PHRASINGS) {
    assert.equal(
      legacyPromptDetectsStrictDocumentGrounding(prompt),
      false,
      `expected strict detector to MISS: ${JSON.stringify(prompt.slice(0, 50))}`,
    );
  }
});

test('legacyPromptDetectsStrictDocumentGrounding: engineered synthetic-probe wording still matches (no behavior change for existing passing probes)', () => {
  const engineered = 'Answer ONLY from the uploaded seminar document I provided. Stick strictly to the material in the reference file. Do not use outside knowledge or my resume.';
  assert.equal(legacyPromptDetectsStrictDocumentGrounding(engineered), true);
});

test('INCIDENT REGRESSION: a mode with reference files + realistic non-strict prompt NEVER migrates to general_mixed', () => {
  for (const prompt of REALISTIC_NON_STRICT_PHRASINGS) {
    const contract = migrateSourceContractFromPrompt({
      customContext: prompt,
      hasReferenceFiles: true,
      hasProfileFacts: true, // résumé also loaded — this is exactly the incident shape
    });
    assert.notEqual(contract.sourceAuthority, 'general_mixed',
      `must never silently promote to general_mixed for: ${JSON.stringify(prompt.slice(0, 50))}`);
    // Ambiguous shape (has files, prompt doesn't clearly declare exclusivity)
    // must migrate to reference_files_primary — reference files own EVERY
    // question by default (not just ones matching an ambiguous-term regex),
    // while explicit résumé/JD/transcript switches still work. Never a
    // silent everything-allowed mix.
    assert.equal(contract.sourceAuthority, 'reference_files_primary');
    assert.equal(contract.defaultOwner, 'reference_files');
    assert.equal(contract.evidenceRequired, true);
    assert.equal(contract.origin, 'migrated_from_prompt');
  }
});

test('migrateSourceContractFromPrompt: strict legacy-matching prompt preserves prior exact behavior (reference_files_only)', () => {
  const contract = migrateSourceContractFromPrompt({
    customContext: 'Answer ONLY from the uploaded seminar document I provided. Stick strictly to the material in the reference file. Do not use outside knowledge or my resume.',
    hasReferenceFiles: true,
    hasProfileFacts: true,
  });
  assert.equal(contract.sourceAuthority, 'reference_files_only');
  assert.equal(contract.defaultOwner, 'reference_files');
  assert.equal(contract.evidenceRequired, true);
  assert.deepEqual(contract.allowedExplicitSwitches, []);
});

test('migrateSourceContractFromPrompt: no reference files, has prompt + profile facts → profile_only', () => {
  const contract = migrateSourceContractFromPrompt({
    customContext: 'Help me rehearse interview answers about my background.',
    hasReferenceFiles: false,
    hasProfileFacts: true,
  });
  assert.equal(contract.sourceAuthority, 'profile_only');
  assert.equal(contract.defaultOwner, 'profile');
});

test('migrateSourceContractFromPrompt: no files, no prompt, no profile → ask_if_ambiguous (safe default)', () => {
  const contract = migrateSourceContractFromPrompt({
    customContext: '',
    hasReferenceFiles: false,
    hasProfileFacts: false,
  });
  assert.equal(contract.sourceAuthority, 'ask_if_ambiguous');
});

test('defaultSourceContractForNewMode: brand-new mode defaults to isolation-aware authority (NOT ask_if_ambiguous)', () => {
  // REGRESSION for the senior-review CRITICAL finding: previously this
  // asserted defaultOwner='clarify' and sourceAuthority='ask_if_ambiguous',
  // which left ownership answer-type-driven and silently leaked profile
  // facts through experience/project/skills answer types in
  // sourceOwnership.ts. The new defaultOwner and sourceAuthority are
  // derived from templateType and isolation-fence the runtime from turn 1.
  // For the no-template fallback (called by getOrMigrateSourceContract
  // when the mode is missing), defaultOwner='reference_files' and
  // sourceAuthority='reference_files_primary' — the safe, doc-grounded
  // default. 'ask_if_ambiguous' never reappears as a seed.
  const contract = defaultSourceContractForNewMode();
  assert.equal(contract.defaultOwner, 'reference_files');
  assert.equal(contract.sourceAuthority, 'reference_files_primary');
  assert.equal(contract.origin, 'default_new_mode');
  assert.equal(contract.evidenceRequired, true);
  assert.equal(contract.conflictPolicy, 'reference_files_win');
  assert.equal(contract.memoryPolicy.allowHindsight, false,
    'doc-grounded modes must seal Hindsight OFF at seed time');
  assert.equal(contract.memoryPolicy.allowPriorAssistantFacts, false,
    'doc-grounded modes must seal prior-assistant-facts OFF at seed time');
});

test('defaultSourceContractForNewMode: per-template sourceAuthority + defaultOwner (isolation gate)', () => {
  // The isolation contract — "Knowledge source is the only source used while
  // meeting" — is enforced by the runtime gates (SourceAuthorityKernel,
  // sourceOwnership, documentGroundedFromContract) which all key on the
  // persisted sourceAuthority and defaultOwner. If the seed hands the runtime
  // an `ask_if_ambiguous` contract, those gates fire only conditionally on
  // answer-type — silently leaking profile facts through experience/project
  // answer types. To prevent that, every template's seed must land at an
  // authority that PROPERLY gates isolation from turn 1.
  const referenceTemplates = ['general', 'sales', 'recruiting', 'team-meet', 'lecture', undefined];
  for (const template of referenceTemplates) {
    const contract = defaultSourceContractForNewMode(template);
    assert.equal(
      contract.sourceAuthority, 'reference_files_primary',
      `templateType=${template ?? '(undefined)'} must seed reference_files_primary (NOT ask_if_ambiguous)`,
    );
    assert.equal(
      contract.defaultOwner, 'reference_files',
      `templateType=${template ?? '(undefined)'} defaultOwner must be reference_files`,
    );
    assert.equal(contract.evidenceRequired, true,
      `templateType=${template ?? '(undefined)'} evidenceRequired must be true for reference_files_primary`);
    assert.equal(contract.conflictPolicy, 'reference_files_win',
      `templateType=${template ?? '(undefined)'} conflictPolicy must be reference_files_win`);
    assert.equal(contract.memoryPolicy.allowHindsight, false,
      `templateType=${template ?? '(undefined)'} Hindsight must be sealed OFF for doc-grounded modes`);
    assert.equal(contract.memoryPolicy.allowPriorAssistantFacts, false,
      `templateType=${template ?? '(undefined)'} prior-assistant-facts must be sealed OFF for doc-grounded modes`);
  }
  const interviewPrep = ['looking-for-work', 'technical-interview'];
  for (const template of interviewPrep) {
    const contract = defaultSourceContractForNewMode(template);
    assert.equal(
      contract.sourceAuthority, 'profile_only',
      `templateType=${template} must seed profile_only`,
    );
    assert.equal(
      contract.defaultOwner, 'profile',
      `templateType=${template} defaultOwner must be profile (interview-prep modes use profile + JD)`,
    );
    assert.equal(contract.evidenceRequired, false,
      `templateType=${template} evidenceRequired must be false (interview-prep has no docs by default)`);
  }
});

test('defaultSourceContractForNewMode: per-template allowedExplicitSwitches (renderer parity)', () => {
  // The seed must mirror the renderer's per-mode default table so a freshly
  // created mode lands on the correct dots without the renderer needing an
  // 'origin !== user_selected' guard. Pre-Fix-B the seed had every switch
  // listed, which forced the renderer to ignore it on every new mode.
  // Regression: keep this in sync with DEFAULT_BY_TEMPLATE in the renderer.
  const cases = [
    { template: undefined,           expect: ['reference_files'] },
    { template: 'general',           expect: ['reference_files'] },
    { template: 'sales',             expect: ['reference_files'] },
    { template: 'recruiting',        expect: ['reference_files'] },
    { template: 'team-meet',         expect: ['reference_files'] },
    { template: 'lecture',           expect: ['reference_files'] },
    { template: 'looking-for-work',  expect: ['profile', 'job_description'] },
    { template: 'technical-interview', expect: ['profile', 'job_description'] },
  ];
  for (const { template, expect: expected } of cases) {
    const contract = defaultSourceContractForNewMode(template);
    assert.deepEqual(
      contract.allowedExplicitSwitches,
      expected,
      `templateType=${template ?? '(undefined)'} should seed ${JSON.stringify(expected)}`,
    );
    // Per Fix A and the always-on transcript design: deprecated 'transcript'
    // is NEVER seeded, regardless of template type.
    assert.ok(
      !contract.allowedExplicitSwitches.includes('transcript'),
      `templateType=${template ?? '(undefined)'} must not seed 'transcript'`,
    );
  }
});

test('buildUserSelectedSourceContract: looking-for-work with profile-only switches produces profile_only (NOT reference_files_primary)', () => {
  // Regression for the HIGH finding in the senior review: the renderer's
  // onSave previously hard-coded defaultOwner='reference_files' and
  // sourceAuthority='reference_files_primary' regardless of template, which
  // forced evidenceRequired=true for interview-prep modes that have no docs.
  // The new flow calls buildUserSelectedSourceContract with
  // defaultOwner='profile' for these modes (derived from templateType in
  // ModesManager.buildUserSourceContract). Verify the server builder honors
  // that input correctly.
  const contract = buildUserSelectedSourceContract({
    defaultOwner: 'profile',
    allowedExplicitSwitches: ['profile', 'job_description'],
  });
  assert.equal(contract.sourceAuthority, 'profile_only');
  assert.equal(contract.defaultOwner, 'profile');
  assert.equal(contract.evidenceRequired, false);
  assert.equal(contract.conflictPolicy, 'profile_wins');
  assert.equal(contract.origin, 'user_selected');
});

test('migrateSourceContractFromPrompt: legacy fallback no longer includes "transcript"', () => {
  // Regression for the MEDIUM finding: prior migration fallback at line ~540
  // included 'transcript' in allowedExplicitSwitches for three branches. The
  // transcript is always-on implicit context via ProviderDataScope, never a
  // user-settable switch — persisting it in the contract is inconsistent
  // with the per-template seed.
  // Walk every fallback branch via migrateSourceContractFromPrompt and assert
  // none of them emit 'transcript'.
  const fallbacks = [
    { customContext: 'just a prompt',         hasReferenceFiles: false, hasProfileFacts: false,
      label: 'empty prompt + no files + no profile' },
    { customContext: 'just a prompt',         hasReferenceFiles: true,  hasProfileFacts: false,
      label: 'ambiguous prompt + files' },
    { customContext: 'just a prompt',         hasReferenceFiles: false, hasProfileFacts: true,
      label: 'profile facts + no files' },
    { customContext: '',                      hasReferenceFiles: true,  hasProfileFacts: false,
      label: 'files only' },
    { customContext: '',                      hasReferenceFiles: false, hasProfileFacts: true,
      label: 'profile facts only' },
  ];
  for (const { customContext, hasReferenceFiles, hasProfileFacts, label } of fallbacks) {
    const migrated = migrateSourceContractFromPrompt({ customContext, hasReferenceFiles, hasProfileFacts });
    assert.ok(
      !migrated.allowedExplicitSwitches.includes('transcript'),
      `migrated contract for "${label}" must not include 'transcript'`,
    );
  }
});

test('buildUserSelectedSourceContract: reference_files + no switches → reference_files_only', () => {
  const contract = buildUserSelectedSourceContract({ defaultOwner: 'reference_files' });
  assert.equal(contract.sourceAuthority, 'reference_files_only');
  assert.equal(contract.evidenceRequired, true);
  assert.equal(contract.conflictPolicy, 'reference_files_win');
  assert.equal(contract.origin, 'user_selected');
});

test('buildUserSelectedSourceContract: reference_files + explicit switches → reference_files_primary (seminar-mode semantics)', () => {
  const contract = buildUserSelectedSourceContract({
    defaultOwner: 'reference_files',
    allowedExplicitSwitches: ['profile', 'job_description', 'transcript'],
  });
  assert.equal(contract.sourceAuthority, 'reference_files_primary');
  assert.deepEqual(contract.allowedExplicitSwitches, ['profile', 'job_description', 'transcript']);
  assert.equal(contract.evidenceRequired, true);
});

test('buildUserSelectedSourceContract: profile default with transcript capability → profile_plus_transcript', () => {
  const contract = buildUserSelectedSourceContract({ defaultOwner: 'profile', hasLiveTranscriptCapable: true });
  assert.equal(contract.sourceAuthority, 'profile_plus_transcript');
});

test('buildUserSelectedSourceContract: transcript default → transcript_only', () => {
  const contract = buildUserSelectedSourceContract({ defaultOwner: 'transcript' });
  assert.equal(contract.sourceAuthority, 'transcript_only');
  assert.equal(contract.conflictPolicy, 'transcript_wins');
});

test('buildUserSelectedSourceContract: mixed default → ask_if_ambiguous', () => {
  const contract = buildUserSelectedSourceContract({ defaultOwner: 'mixed' });
  assert.equal(contract.sourceAuthority, 'ask_if_ambiguous');
  assert.equal(contract.conflictPolicy, 'ask_clarification');
});

test('serialize/parse round-trip preserves the contract exactly', () => {
  const original = buildUserSelectedSourceContract({
    defaultOwner: 'reference_files',
    allowedExplicitSwitches: ['profile'],
  });
  const json = serializeModeSourceContract(original);
  const parsed = parseModeSourceContract(json);
  assert.deepEqual(parsed, original);
});

test('parseModeSourceContract rejects malformed/legacy/absent input (never throws)', () => {
  assert.equal(parseModeSourceContract(null), null);
  assert.equal(parseModeSourceContract(undefined), null);
  assert.equal(parseModeSourceContract(''), null);
  assert.equal(parseModeSourceContract('not json'), null);
  assert.equal(parseModeSourceContract('{}'), null);
  assert.equal(parseModeSourceContract(JSON.stringify({ version: 2 })), null);
});

test('documentGroundedFromContract: true only for reference-files authorities AND files present', () => {
  const refOnly = buildUserSelectedSourceContract({ defaultOwner: 'reference_files' });
  const refPrimary = buildUserSelectedSourceContract({ defaultOwner: 'reference_files', allowedExplicitSwitches: ['profile'] });
  const profileOnly = buildUserSelectedSourceContract({ defaultOwner: 'profile' });

  assert.equal(documentGroundedFromContract(refOnly, true), true);
  assert.equal(documentGroundedFromContract(refOnly, false), false, 'no files present → never grounded regardless of contract');
  assert.equal(documentGroundedFromContract(refPrimary, true), true);
  assert.equal(documentGroundedFromContract(profileOnly, true), false);
});
