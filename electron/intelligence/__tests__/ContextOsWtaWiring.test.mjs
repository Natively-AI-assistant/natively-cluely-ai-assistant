// Context OS Phase 8 — What-to-Answer wiring.
//
// Proves: (1) the WTA contract for a doc-grounded mode denies profile evidence
// (the expression IntelligenceEngine uses to clear candidateProfile), (2) the
// engine actually wires the suppression + repair gate (structural assertions),
// (3) prior assistant facts are denied on every WTA contract.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsWtaWiring.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

process.env.NATIVELY_CONTEXT_OS = '1';
process.env.NATIVELY_CONTEXT_OS_WTA = '1';

const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

function wtaContract(overrides = {}) {
  return co.buildTurnContractIfEnabled({
    surface: 'what_to_answer',
    question: 'What are the four main phases of the project?',
    activeModeId: 'mode-1',
    sourceAuthority: 'reference_files_only',
    answerType: 'list_answer',
    plannerVoicePerspective: 'first_person_candidate',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: true,
    ...overrides,
  });
}

// ── Contract behavior on the WTA surface ────────────────────────────────────

test('doc-grounded WTA: profile evidence denied → candidateProfile suppression fires', () => {
  const c = wtaContract();
  assert.ok(c, 'WTA surface must be enabled');
  const contractAllowsProfile = co.allowsEvidence(c, 'profile_resume') || co.allowsEvidence(c, 'profile_project');
  assert.equal(contractAllowsProfile, false);
  assert.equal(c.sourceOwner, 'reference_files');
});

test('doc-grounded WTA: persona, custom notes, hindsight, prior claims all forbidden', () => {
  const c = wtaContract();
  for (const k of ['profile_persona', 'custom_profile_notes', 'hindsight_memory', 'prior_assistant_claim']) {
    assert.ok(c.forbiddenSources.includes(k), `${k} must be forbidden in doc-grounded WTA`);
  }
});

test('interview WTA: profile allowed; transcript is referent-only (interviewer question)', () => {
  const c = wtaContract({ sourceAuthority: 'profile_plus_transcript', question: 'Tell me about your best project.' });
  assert.equal(co.allowsEvidence(c, 'profile_resume'), true);
  assert.equal(co.isReferentOnly(c, 'live_transcript'), true);
});

test('WTA prior assistant facts are denied for EVERY authority', () => {
  for (const sourceAuthority of ['reference_files_only', 'profile_plus_transcript', 'transcript_only', 'general_mixed']) {
    const c = wtaContract({ sourceAuthority });
    assert.equal(c.memoryReadPolicy.allowPriorAssistantFacts, false, sourceAuthority);
    assert.equal(co.allowsEvidence(c, 'prior_assistant_message'), false, sourceAuthority);
  }
});

test('WTA surface flag off → null (legacy WTA untouched)', () => {
  process.env.NATIVELY_CONTEXT_OS_WTA = '0';
  try {
    assert.equal(wtaContract(), null);
  } finally {
    process.env.NATIVELY_CONTEXT_OS_WTA = '1';
  }
});

// ── Structural wiring assertions against IntelligenceEngine.ts ─────────────

const engineSource = fs.readFileSync(path.resolve(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

test('WIRING: runWhatShouldISay builds the WTA contract from the legacy sourceAuthority', () => {
  assert.ok(engineSource.includes("surface: 'what_to_answer'"), 'WTA surface missing');
  assert.ok(engineSource.includes('_legacyContract2.sourceAuthority'), 'kernel must consume the legacy arbiter authority');
});

test('WIRING: candidateProfile is CLEARED when the contract denies profile evidence', () => {
  assert.match(engineSource, /if \(!contractAllowsProfileWta && candidateProfile\) \{[\s\S]{0,400}candidateProfile = ''/, 'profile suppression missing');
});

test('WIRING: the profile REPAIR gate consults the contract (regen leak closed)', () => {
  assert.ok(engineSource.includes('contractPermitsProfileRepair'), 'repair gate missing');
  assert.match(engineSource, /profileLoaded && contractPermitsProfileRepair && answerPlan\.voicePerspective === 'first_person_candidate'/, 'repair must AND the contract check');
});

test('WIRING: WTA contract failure is non-fatal', () => {
  assert.match(engineSource, /\[CONTEXT-OS\] WTA contract build skipped \(non-fatal\)/);
});

// ── Doc-grounded prior-responses suppression (pre-existing, must not regress) ──

const wtaLlmSource = fs.readFileSync(path.resolve(repoRoot, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8');

test('WIRING: WTA prompt suppresses prior responses in doc-grounded mode (pre-existing gate preserved)', () => {
  assert.match(wtaLlmSource, /priorResponses: !documentGroundedCustomModeActiveForPrompt/, 'doc-grounded prior-responses suppression must remain');
});
