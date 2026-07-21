// Regression tests for the 4 deferred items closed in commit 41edd51's
// follow-up (2026-07-16):
//   1. WTA path in IntelligenceEngine threads turnSourceDecision +
//      wtaDecisionAllowsCandidateProfile gate.
//   2. Final-prompt validator runs unconditionally when governed pack exists.
//   3. Kernel legacy issueCapabilities JD-gate honors allowedExplicitSwitches.
//   4. Kernel canonical-decision issueDecisionCapabilities grants
//      okf_profile_card ONLY for profile_resume / projects (NOT for profile_jd).
//
// Run with: npm run build:electron && node --test electron/llm/__tests__/DeferredItemFixes2026_07_16.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');

const cjsRequire = (await import('node:module')).createRequire(import.meta.url);
const { SourceAuthorityKernel } = cjsRequire(
  path.resolve(distDir, 'intelligence/context-os/SourceAuthorityKernel.js'),
);

// ── Item #3: legacy path JD-gate via allowedExplicitSwitches ──────────────

test('legacy path: profile_only + allowedExplicitSwitches without job_description → NO profile_jd capability', () => {
  const kernel = new SourceAuthorityKernel();
  const contract = kernel.build({
    surface: 'manual_chat',
    question: 'Tell me about my best project.',
    activeModeId: 'mode-no-jd',
    sourceAuthority: 'profile_only',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: false,
    hasProfileFacts: true,
    hasLiveTranscript: false,
    userExplicitSource: null,
    // PERSISTED user toggled off JD — contract.allowExplicitSwitches=['profile']
    allowedExplicitSwitches: ['profile'],
  });
  const jd = contract.allowedSources.find((c) => c.sourceKind === 'profile_jd');
  assert.equal(jd, undefined,
    'profile_jd MUST NOT be granted when the persisted contract excludes job_description');
  // Resume + projects should still be granted (profile is the owner).
  const resume = contract.allowedSources.find((c) => c.sourceKind === 'profile_resume');
  assert.ok(resume, 'profile_resume is granted (profile is the owner)');
});

test('legacy path: profile_only + allowedExplicitSwitches with job_description → profile_jd granted', () => {
  const kernel = new SourceAuthorityKernel();
  const contract = kernel.build({
    surface: 'manual_chat',
    question: 'Tell me about my best project.',
    activeModeId: 'mode-with-jd',
    sourceAuthority: 'profile_only',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: false,
    hasProfileFacts: true,
    hasLiveTranscript: false,
    userExplicitSource: null,
    allowedExplicitSwitches: ['profile', 'job_description'],
  });
  const jd = contract.allowedSources.find((c) => c.sourceKind === 'profile_jd');
  assert.ok(jd, 'profile_jd is granted when the contract permits it');
});

test('legacy path: profile_only + no allowedExplicitSwitches (legacy fallback) → profile_jd granted', () => {
  // Pre-repair behavior: with no allowlist info, the kernel grants whatever
  // the sourceAuthority permits. This preserves the legacy fallback shape.
  const kernel = new SourceAuthorityKernel();
  const contract = kernel.build({
    surface: 'manual_chat',
    question: 'Tell me about my best project.',
    activeModeId: 'mode-no-allowlist',
    sourceAuthority: 'profile_only',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: false,
    hasProfileFacts: true,
    hasLiveTranscript: false,
    userExplicitSource: null,
    allowedExplicitSwitches: null,
  });
  const jd = contract.allowedSources.find((c) => c.sourceKind === 'profile_jd');
  assert.ok(jd, 'legacy fallback grants profile_jd when no allowlist info is supplied');
});

// ── Item #4: OKF profile card is gated on profile_resume / projects only ─

test('canonical-decision: JD-only decision grants profile_jd but NOT okf_profile_card', () => {
  const kernel = new SourceAuthorityKernel();
  const { resolveTurnSourceDecision } = cjsRequire(
    path.resolve(distDir, 'llm/turnSourceDecision.js'),
  );
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
  const contract = kernel.build({
    surface: 'manual_chat',
    question: 'According to the JD, what is the role?',
    activeModeId: 'mode-jd-only',
    sourceAuthority: 'reference_files_primary',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: false,
    userExplicitSource: null,
    turnSourceDecision: decision,
  });
  const jd = contract.allowedSources.find((c) => c.sourceKind === 'profile_jd');
  const okfProfile = contract.allowedSources.find((c) => c.sourceKind === 'okf_profile_card');
  assert.ok(jd, 'profile_jd IS granted (JD-only decision)');
  assert.equal(okfProfile, undefined,
    'okf_profile_card MUST NOT be granted on a JD-only decision (no profile_resume / projects)');
});

test('canonical-decision: résumé-only decision grants profile_resume AND okf_profile_card', () => {
  const kernel = new SourceAuthorityKernel();
  const { resolveTurnSourceDecision } = cjsRequire(
    path.resolve(distDir, 'llm/turnSourceDecision.js'),
  );
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile'],
    },
    explicitRequest: 'profile',
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
  const contract = kernel.build({
    surface: 'manual_chat',
    question: 'According to my résumé, what is my best project?',
    activeModeId: 'mode-resume-only',
    sourceAuthority: 'reference_files_primary',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: false,
    userExplicitSource: null,
    turnSourceDecision: decision,
  });
  const resume = contract.allowedSources.find((c) => c.sourceKind === 'profile_resume');
  const okfProfile = contract.allowedSources.find((c) => c.sourceKind === 'okf_profile_card');
  assert.ok(resume, 'profile_resume IS granted (résumé-only decision)');
  assert.ok(okfProfile, 'okf_profile_card IS granted (resume decision grants it)');
});