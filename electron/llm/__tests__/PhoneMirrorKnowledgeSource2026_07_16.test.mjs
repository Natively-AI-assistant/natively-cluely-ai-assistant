// Phone-mirror Knowledge Source gate regression test
// (senior-review audit ab9dc2f0 MEDIUM #1, 2026-07-16).
//
// Verifies that buildCustomModeExecutionContract + resolveSourceOwnership
// (the two functions the phone-mirror IPC now threads turnSourceDecision
// through) produce a JD-only contract + owner='profile' + adapter
// shouldClarifyInsteadOfProfile=false when given a JD-only grant on a
// resume-bearing mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');

const { resolveTurnSourceDecision } = await import(
  pathToFileURL(path.join(distDir, 'llm/turnSourceDecision.js')).href
);
const { buildCustomModeExecutionContract } = await import(
  pathToFileURL(path.join(distDir, 'llm/customModeExecutionContract.js')).href
);
const { resolveSourceOwnership } = await import(
  pathToFileURL(path.join(distDir, 'llm/sourceOwnership.js')).href
);

test('phone-mirror: JD-only grant on resume-bearing mode grants only profile_jd (not résumé)', () => {
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
  const contract = buildCustomModeExecutionContract({
    question: 'According to the JD, what does the role require?',
    streamRoute: 'phone_mirror',
    modeId: 'phone-mode', modeUniqueId: 'phone-mode',
    answerType: 'jd_requirements_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: false,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: true,
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_primary',
    userExplicitSource: 'profile',
    turnSourceDecision: decision,
  });
  assert.equal(contract.allowedSources.includes('profile_jd'), true);
  assert.equal(contract.allowedSources.includes('profile_resume'), false,
    'JD-only decision must NOT allow profile_resume on phone_mirror');
  assert.equal(contract.allowedSources.includes('projects'), false);

  const ownership = resolveSourceOwnership({
    question: 'According to the JD, what does the role require?',
    contract,
    profileContextPolicy: 'allowed',
    answerType: 'jd_requirements_answer',
    hasProfileFacts: true,
    turnSourceDecision: decision,
  });
  assert.equal(ownership.profileAllowed, true);
  assert.equal(ownership.shouldClarifyInsteadOfProfile, false,
    'JD-only grant on a JD-permitting contract must NOT clarify — it must proceed');
});

test('phone-mirror: strict reference_files_only + profile ask denies (orchestrator silent)', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_only',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequest: 'profile',
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
  assert.equal(decision.outcome, 'explicit_denied');
  assert.equal(decision.owner, 'clarify');

  // Without turnSourceDecision the contract falls back to the authority
  // heuristic (legacy behavior preserved).
  const contract = buildCustomModeExecutionContract({
    question: 'According to my résumé, what is my best project?',
    streamRoute: 'phone_mirror',
    modeId: 'phone-mode', modeUniqueId: 'phone-mode',
    answerType: 'project_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: true,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: true,
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_only',
    userExplicitSource: 'profile',
  });
  const ownership = resolveSourceOwnership({
    question: 'According to my résumé, what is my best project?',
    contract,
    profileContextPolicy: 'allowed',
    answerType: 'project_answer',
    hasProfileFacts: true,
  });
  assert.equal(ownership.shouldClarifyInsteadOfProfile, true,
    'strict-mode phone path with explicit profile ask must clarify');
});

test('phone-mirror: resume-only grant grants profile_resume (orchestrator may run)', () => {
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
  const contract = buildCustomModeExecutionContract({
    question: 'According to my résumé, what is my best project?',
    streamRoute: 'phone_mirror',
    modeId: 'phone-mode', modeUniqueId: 'phone-mode',
    answerType: 'project_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: false,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: true,
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_primary',
    userExplicitSource: 'profile',
    turnSourceDecision: decision,
  });
  const ownership = resolveSourceOwnership({
    question: 'According to my résumé, what is my best project?',
    contract,
    profileContextPolicy: 'allowed',
    answerType: 'project_answer',
    hasProfileFacts: true,
    turnSourceDecision: decision,
  });
  assert.equal(ownership.owner, 'profile');
  assert.equal(ownership.profileAllowed, true);
  assert.equal(ownership.shouldClarifyInsteadOfProfile, false);
  assert.match(ownership.reason, /turn_source_decision:explicit_profile_granted/);
});