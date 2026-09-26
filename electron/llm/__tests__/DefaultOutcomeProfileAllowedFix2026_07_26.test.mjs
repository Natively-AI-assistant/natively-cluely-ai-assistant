// electron/llm/__tests__/DefaultOutcomeProfileAllowedFix2026_07_26.test.mjs
//
// Bug fix (2026-07-26, live-testing session) — the piece of the live "wrong
// answers" bug that a fix to turnSourceDecision.ts/SourceAuthorityKernel.ts
// ALONE does not close. `resolveSourceOwnership`'s canonical-decision branch
// computed `profileAllowed = d.outcome === 'explicit_granted' && ...` — so a
// 'default'-outcome decision (the ordinary un-switched turn: profile_only,
// general_mixed, ask_if_ambiguous with no explicit switch typed this turn)
// ALWAYS produced profileAllowed=false, no matter what allowedEvidenceKinds
// granted. ipcHandlers.ts's manual-chat path reads
// `manualOwnership.profileAllowed` directly (`sourceOwnershipAllowsProfile`,
// then `profileEvidenceEligible`) to decide whether to build ANY profile/JD
// evidence for the prompt at all — so this is the actual gate that produced
// the live symptom (selectedEvidenceCount: 0, fabricated role-fit answers),
// independent of the turnSourceDecision.ts/SourceAuthorityKernel.ts fixes
// which only repair the Context OS *observe-mode* trace
// (turnContract.allowedSources/forbiddenSources), not this legacy gate.
//
// Fix mirrors the already-correct `wtaDecisionAllowsCandidateProfile`
// pattern in IntelligenceEngine.ts (electron/IntelligenceEngine.ts ~1412):
// allow on `outcome === 'default' || outcome === 'explicit_granted'`, gated
// by allowedEvidenceKinds — not `explicit_granted` alone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const { resolveTurnSourceDecision } = await import(
  pathToFileURL(path.join(distDir, 'llm/turnSourceDecision.js')).href
);
const { resolveSourceOwnership } = await import(
  pathToFileURL(path.join(distDir, 'llm/sourceOwnership.js')).href
);

function mode(sourceAuthority, allowedExplicitSwitches = ['reference_files', 'profile', 'job_description', 'transcript']) {
  return { defaultOwner: 'mixed', sourceAuthority, allowedExplicitSwitches };
}

describe('resolveSourceOwnership: default-outcome decisions now set profileAllowed from allowedEvidenceKinds', () => {
  test('the live-repro case: ask_if_ambiguous, no explicit switch, JD+resume loaded → profileAllowed=true', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('ask_if_ambiguous'),
      persistedSourceAuthority: 'ask_if_ambiguous',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.outcome, 'default');
    const ownership = resolveSourceOwnership({
      question: "What's the compensation range for this role?",
      contract: { sourceAuthority: 'ask_if_ambiguous' },
      profileContextPolicy: 'allowed',
      answerType: 'jd_fact_answer',
      hasProfileFacts: true,
      turnSourceDecision: decision,
    });
    assert.equal(ownership.profileAllowed, true, 'profile/JD evidence must be eligible to build for the prompt on the ordinary default turn, not only on an explicit switch');
  });

  test('profile_only default (no explicit switch) also gets profileAllowed=true (was already correct at the decision layer, now correct end-to-end)', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('profile_only'),
      persistedSourceAuthority: 'profile_only',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: true,
        hasJobDescription: false,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.outcome, 'default');
    const ownership = resolveSourceOwnership({
      question: 'Tell me about my best project.',
      contract: { sourceAuthority: 'profile_only' },
      profileContextPolicy: 'allowed',
      answerType: 'project_answer',
      hasProfileFacts: true,
      turnSourceDecision: decision,
    });
    assert.equal(ownership.profileAllowed, true);
  });

  test('no regression: default reference_files_only decision (no profile kind in allowedEvidenceKinds) → profileAllowed stays false', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: { defaultOwner: 'reference_files', sourceAuthority: 'reference_files_only', allowedExplicitSwitches: [] },
      persistedSourceAuthority: 'reference_files_only',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: true,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.outcome, 'default');
    const ownership = resolveSourceOwnership({
      question: 'What does the document say about X?',
      contract: { sourceAuthority: 'reference_files_only' },
      profileContextPolicy: 'allowed',
      answerType: 'document_fact_answer',
      hasProfileFacts: true,
      turnSourceDecision: decision,
    });
    assert.equal(ownership.profileAllowed, false, 'a strict reference_files_only default decision must never leak profile eligibility');
  });

  test('no regression: an explicit_denied decision (strict mode denies an explicit profile ask) stays profileAllowed=false', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: { defaultOwner: 'reference_files', sourceAuthority: 'reference_files_only', allowedExplicitSwitches: [] },
      persistedSourceAuthority: 'reference_files_only',
      explicitRequest: 'profile',
      explicitRequests: ['profile'],
      availability: {
        hasReferenceFiles: true,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.outcome, 'explicit_denied');
    const ownership = resolveSourceOwnership({
      question: 'What is my best project?',
      contract: { sourceAuthority: 'reference_files_only' },
      profileContextPolicy: 'allowed',
      answerType: 'project_answer',
      hasProfileFacts: true,
      turnSourceDecision: decision,
    });
    assert.equal(ownership.profileAllowed, false);
  });

  test('no regression: explicit_granted JD-only decision still sets profileAllowed=true (pre-existing correct behavior preserved)', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: { defaultOwner: 'reference_files', sourceAuthority: 'reference_files_primary', allowedExplicitSwitches: ['job_description'] },
      persistedSourceAuthority: 'reference_files_primary',
      explicitRequest: 'job_description',
      explicitRequests: ['job_description'],
      availability: {
        hasReferenceFiles: true,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.outcome, 'explicit_granted');
    const ownership = resolveSourceOwnership({
      question: 'According to the JD, what does the role require?',
      contract: { sourceAuthority: 'reference_files_primary' },
      profileContextPolicy: 'allowed',
      answerType: 'jd_requirements_answer',
      hasProfileFacts: true,
      turnSourceDecision: decision,
    });
    assert.equal(ownership.profileAllowed, true);
  });
});
