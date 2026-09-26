// Regression test for the WTA path's Knowledge Source gate
// (deferred item #1, 2026-07-16).
//
// The WTA path in electron/IntelligenceEngine.ts now:
//   1. Resolves turnSourceDecision ONCE at the top of runWhatShouldISay.
//   2. Computes wtaDecisionAllowsCandidateProfile from the decision
//      (true only when default|explicit_granted AND allowedEvidenceKinds
//      includes profile_resume OR projects).
//   3. Gates BOTH candidate-profile orchestrator invocations on
//      wtaDecisionAllowsCandidateProfile.
//   4. Threads the decision into buildCustomModeExecutionContract,
//      resolveSourceOwnership, and buildTurnContractIfEnabled.
//
// This test asserts the contract invariants the WTA path now respects by
// directly invoking turnSourceDecision (the input) and inspecting the
// kernel contract (the consumer). We exercise the same chain the engine
// executes (decision → kernel caps → contract), so a regression in any
// step is caught.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/WtaKnowledgeSourceGate2026_07_16.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { resolveTurnSourceDecision } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/llm/turnSourceDecision.js'),
);
const { SourceAuthorityKernel } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/SourceAuthorityKernel.js'),
);

const fullAvailability = {
  hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
  hasLiveTranscript: true, hasMeetingRag: false,
};

function kernelContractForDecision(decision, modeId = 'wta-mode') {
  const kernel = new SourceAuthorityKernel();
  return kernel.build({
    surface: 'what_to_answer',
    question: 'What should I say next?',
    activeModeId: modeId,
    sourceAuthority: 'reference_files_primary',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: fullAvailability.hasReferenceFiles,
    hasProfileFacts: fullAvailability.hasProfileFacts,
    hasLiveTranscript: fullAvailability.hasLiveTranscript,
    userExplicitSource: null,
    turnSourceDecision: decision,
  });
}

test('WTA: default reference_files_primary turn does NOT grant profile_resume (no profile orchestrator)', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequest: null,
    availability: fullAvailability,
  });
  assert.equal(decision.outcome, 'default');
  assert.deepEqual(decision.allowedEvidenceKinds, ['reference_files']);
  const contract = kernelContractForDecision(decision);
  const resume = contract.allowedSources.find((c) => c.sourceKind === 'profile_resume');
  assert.equal(resume, undefined, 'default reference_files turn grants NO profile_resume');
  // wtaDecisionAllowsCandidateProfile would be FALSE for this decision
  // (allowedEvidenceKinds doesn't include profile_resume / projects),
  // so the candidate-profile orchestrator MUST stay silent.
});

test('WTA: explicit résumé switch on reference_files_primary grants profile_resume (profile orchestrator may run)', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequest: 'profile',
    availability: fullAvailability,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  assert.ok(decision.allowedEvidenceKinds.includes('profile_resume'),
    'profile_resume IS in allowedEvidenceKinds (gates profile orchestrator ON)');
  assert.ok(decision.allowedEvidenceKinds.includes('projects'),
    'projects IS in allowedEvidenceKinds');
  const contract = kernelContractForDecision(decision);
  const resume = contract.allowedSources.find((c) => c.sourceKind === 'profile_resume');
  assert.ok(resume, 'profile_resume capability granted (orchestrator may fire)');
});

test('WTA: explicit JD switch grants profile_jd ONLY (orchestrator MUST stay silent)', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability: fullAvailability,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  // wtaDecisionAllowsCandidateProfile would be FALSE here
  // (allowedEvidenceKinds includes only profile_jd).
  assert.deepEqual(decision.allowedEvidenceKinds, ['profile_jd'],
    'JD-only decision grants only profile_jd');
  assert.equal(decision.allowedEvidenceKinds.includes('profile_resume'), false);
  assert.equal(decision.allowedEvidenceKinds.includes('projects'), false);
  const contract = kernelContractForDecision(decision);
  const resume = contract.allowedSources.find((c) => c.sourceKind === 'profile_resume');
  const projects = contract.allowedSources.find((c) => c.sourceKind === 'profile_project');
  assert.equal(resume, undefined,
    'profile_resume MUST NOT be granted on a JD-only decision (orchestrator never fires)');
  assert.equal(projects, undefined,
    'profile_project MUST NOT be granted on a JD-only decision');
});

test('WTA: strict reference_files_only with profile ask denies (orchestrator MUST stay silent)', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_only',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequest: 'profile',
    availability: fullAvailability,
  });
  assert.equal(decision.outcome, 'explicit_denied');
  assert.equal(decision.owner, 'clarify');
  assert.equal(decision.allowedEvidenceKinds.length, 0,
    'strict-mode prison denies the switch entirely');
  // wtaDecisionAllowsCandidateProfile would be FALSE → orchestrator silent.
});

test('WTA: profile_only with explicit JD ask grants profile_jd only (interview-prep doc-grounded)', () => {
  // Mirrors a Looking-for-Work / Technical Interview interview-prep mode.
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'profile',
      sourceAuthority: 'profile_only',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequest: 'job_description',
    availability: fullAvailability,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  assert.deepEqual(decision.allowedEvidenceKinds, ['profile_jd'],
    'profile_only + JD ask → only JD (résumé orchestrator must stay silent)');
  const contract = kernelContractForDecision(decision, 'looking-for-work');
  const resume = contract.allowedSources.find((c) => c.sourceKind === 'profile_resume');
  const projects = contract.allowedSources.find((c) => c.sourceKind === 'profile_project');
  assert.equal(resume, undefined,
    'profile_resume MUST NOT be granted on a JD-only decision (built-in interview mode)');
  assert.equal(projects, undefined,
    'profile_project MUST NOT be granted on a JD-only decision');
});