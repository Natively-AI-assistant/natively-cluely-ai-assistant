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

// ── Invariant 5 (2026-09-05): an absent DEFAULT source with no explicit request
// answers from what remains; it does not clarify. This was live: technical-
// interview and looking-for-work seed profile_only, and with no résumé uploaded
// every interviewer question was refused before generation with "switch to a
// mode that enables your résumé". Nothing private was requested, so answering
// from the transcript widens nothing. Strict authorities are unchanged.
const nothingLoaded = { hasReferenceFiles: false, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: true, hasMeetingRag: false };
const decide = (authority, extra = {}) => resolveTurnSourceDecision({
  sourceContract: { sourceAuthority: authority, defaultOwner: authority.startsWith('profile') ? 'profile' : authority.startsWith('reference') ? 'reference_files' : null },
  persistedSourceAuthority: authority, explicitRequest: null, explicitRequests: [],
  availability: nothingLoaded, ...extra,
});

test('inv5: profile_only with no résumé and no request answers by default in the profile voice, granting nothing', () => {
  const d = decide('profile_only');
  assert.equal(d.outcome, 'default');
  assert.equal(d.owner, 'profile');
  assert.deepEqual(d.allowedEvidenceKinds, []);
  assert.deepEqual(d.requiredEvidenceKinds, []);
  assert.match(d.reasonCode, /default_profile_absent_answer_from_context/);
});

test('inv5: the legacy adapter then does NOT clarify and does NOT allow profile (nothing to allow)', () => {
  const own = resolveSourceOwnership({ question: 'so how would you shard that', turnSourceDecision: decide('profile_only') });
  assert.equal(own.shouldClarifyInsteadOfProfile, false, 'no clarification for a question that asked for no source');
  assert.equal(own.profileAllowed, false, 'no profile facts exist to allow');
  assert.equal(own.owner, 'profile');
});

test('inv5: profile_plus_transcript with no résumé keeps the live transcript', () => {
  const d = decide('profile_plus_transcript');
  assert.equal(d.outcome, 'default');
  assert.deepEqual(d.allowedEvidenceKinds, ['live_transcript']);
});

test('inv5: reference_files_primary with nothing attached answers from the transcript, not a clarification', () => {
  const d = decide('reference_files_primary');
  assert.equal(d.outcome, 'default');
  assert.equal(d.owner, 'reference_files');
  assert.deepEqual(d.allowedEvidenceKinds, ['live_transcript']);
  assert.deepEqual(d.requiredEvidenceKinds, []);
});

test('inv3 intact: STRICT reference_files_only with nothing attached still fails closed', () => {
  const d = decide('reference_files_only');
  assert.equal(d.outcome, 'source_unavailable');
  assert.equal(d.owner, 'clarify');
  assert.equal(d.reasonCode, 'default_reference_files_unavailable');
});

test('inv2 intact: an EXPLICIT request for an unavailable source still fails closed', () => {
  const d = resolveTurnSourceDecision({
    sourceContract: { sourceAuthority: 'reference_files_primary', defaultOwner: 'reference_files' },
    persistedSourceAuthority: 'reference_files_primary',
    explicitRequest: 'profile', explicitRequests: ['profile'],
    availability: { ...nothingLoaded, hasReferenceFiles: true },
  });
  assert.equal(d.outcome, 'source_unavailable', 'asking for a résumé that is not loaded must still be refused honestly');
});
