// Lossless per-turn source-policy tests (2026-07-15).
//
// Run with: npm run build:electron && node --test electron/llm/__tests__/TurnSourceDecision2026_07_15.test.mjs
//
// These tests exercise the lossless TurnSourceDecision contract:
// JD-only / résumé-only / strict / comparison / unavailability /
// legacy ownership adapter.

import { test } from 'node:test';
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

const available = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: true,
  hasMeetingRag: true,
};

function mode(allowedExplicitSwitches, sourceAuthority = 'reference_files_primary') {
  return {
    defaultOwner: 'reference_files',
    sourceAuthority,
    allowedExplicitSwitches,
  };
}

test('JD-only selection grants only JD evidence', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['job_description']),
    explicitRequest: 'job_description',
    availability: available,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  assert.deepEqual(decision.allowedEvidenceKinds, ['profile_jd']);
  assert.deepEqual(decision.requiredEvidenceKinds, ['profile_jd']);
});

test('legacy ownership adapter keeps a granted JD-only decision independent of résumé availability', () => {
  const turnSourceDecision = resolveTurnSourceDecision({
    sourceContract: mode(['job_description']),
    explicitRequest: 'job_description',
    availability: { ...available, hasProfileFacts: false },
  });
  const ownership = resolveSourceOwnership({
    question: 'According to the JD, what does the role require?',
    contract: { sourceAuthority: 'reference_files_primary' },
    profileContextPolicy: 'allowed',
    answerType: 'jd_requirements_answer',
    hasProfileFacts: false,
    turnSourceDecision,
  });
  assert.equal(ownership.owner, 'profile');
  assert.equal(ownership.profileAllowed, true);
  assert.equal(ownership.shouldClarifyInsteadOfProfile, false);
  assert.match(ownership.reason, /turn_source_decision:explicit_job_description_granted/);
});

test('legacy ownership adapter fails closed for unavailable JD without résumé fallback', () => {
  const turnSourceDecision = resolveTurnSourceDecision({
    sourceContract: mode(['job_description']),
    explicitRequest: 'job_description',
    availability: { ...available, hasJobDescription: false },
  });
  const ownership = resolveSourceOwnership({
    question: 'According to the JD, what does the role require?',
    contract: { sourceAuthority: 'reference_files_primary' },
    profileContextPolicy: 'allowed',
    answerType: 'jd_requirements_answer',
    hasProfileFacts: true,
    turnSourceDecision,
  });
  assert.equal(ownership.profileAllowed, false);
  assert.equal(ownership.shouldClarifyInsteadOfProfile, true);
  assert.match(ownership.reason, /job_description_unavailable/);
});

test('profile-only selection denies an explicit JD request', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['profile']),
    explicitRequest: 'job_description',
    availability: available,
  });
  assert.equal(decision.outcome, 'explicit_denied');
  assert.equal(decision.owner, 'clarify');
  assert.equal(decision.reasonCode, 'explicit_switch_not_enabled');
  assert.deepEqual(decision.allowedEvidenceKinds, []);
});

test('JD-only selection denies an explicit résumé request', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['job_description']),
    explicitRequest: 'profile',
    availability: available,
  });
  assert.equal(decision.outcome, 'explicit_denied');
  assert.equal(decision.owner, 'clarify');
});

test('strict reference mode denies profile and JD even if malformed legacy data lists them', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['profile', 'job_description'], 'reference_files_only'),
    explicitRequest: 'job_description',
    availability: available,
  });
  assert.equal(decision.outcome, 'explicit_denied');
  assert.equal(decision.reasonCode, 'reference_files_only:strict_mode');
});

test('an unavailable selected JD produces an explicit unavailable result without profile fallback', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['job_description']),
    explicitRequest: 'job_description',
    availability: { ...available, hasJobDescription: false },
  });
  assert.equal(decision.outcome, 'source_unavailable');
  assert.equal(decision.reasonCode, 'job_description_unavailable');
  assert.deepEqual(decision.allowedEvidenceKinds, []);
});

test('an ordinary turn remains owned by the default reference source', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['profile', 'job_description']),
    explicitRequest: null,
    availability: available,
  });
  assert.equal(decision.outcome, 'default');
  assert.equal(decision.owner, 'reference_files');
  assert.deepEqual(decision.requiredEvidenceKinds, ['reference_files']);
});

test('an explicit reference-file plus résumé comparison requires both families', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['reference_files', 'profile']),
    explicitRequests: ['reference_files', 'profile'],
    availability: available,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  assert.equal(decision.owner, 'mixed');
  assert.deepEqual(decision.requiredEvidenceKinds, ['reference_files', 'profile_resume', 'projects']);
});

test('an explicit résumé plus JD comparison requires both families', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: mode(['profile', 'job_description']),
    explicitRequests: ['profile', 'job_description'],
    availability: available,
  });
  assert.equal(decision.outcome, 'explicit_granted');
  assert.equal(decision.owner, 'mixed');
  assert.deepEqual(decision.requiredEvidenceKinds, ['profile_resume', 'projects', 'profile_jd']);
});
