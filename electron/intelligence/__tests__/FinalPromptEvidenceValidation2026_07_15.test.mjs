// Final provider-boundary required-family validation (2026-07-15).
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/FinalPromptEvidenceValidation2026_07_15.test.mjs
//
// These tests intentionally validate the FINAL RENDERED PROMPT rather than a
// retriever call or intermediate pack. A required family only counts when its
// exact evidence ID remains in the payload supplied to the provider adapter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { validateFinalPromptEvidence, buildRenderedEvidenceManifest } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'),
);
const { resolveTurnSourceDecision } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/llm/turnSourceDecision.js'),
);

const contract = {
  turnId: 'turn-source-proof',
  surface: 'manual_chat',
  activeModeId: 'mode-source-proof',
  activeModeName: 'Source Proof',
  answerShape: 'general',
  sourceOwner: 'mixed',
  requestedProperty: 'unknown',
  voicePerspective: 'first_person_candidate',
  allowedSources: [],
  forbiddenSources: [],
  referentOnlySources: [],
  conflictPolicy: 'ask_clarification',
  memoryReadPolicy: { allowHindsight: false, allowPriorAssistantFacts: false, allowPriorAssistantReferents: true },
  memoryWritePolicy: { allowAssistantMessage: true, allowVerifiedClaims: true, allowUnverifiedClaims: false },
  enforcement: 'observe',
  reason: 'test',
};

function item(evidenceId, sourceKind, sourceId) {
  return {
    evidenceId, sourceKind, sourceId, sourceOwner: 'profile', authority: 'evidence', trustLevel: 'profile_verified',
    text: `${sourceKind}:${sourceId}`, supports: { property: 'unknown' }, score: { final: 1 }, reasonIncluded: 'test',
  };
}

function pack(items, answerPolicy = 'answer') {
  return {
    turnId: contract.turnId, sourceOwner: 'mixed', requestedProperty: 'unknown', items, rejected: [],
    coverage: { hasDirectEvidence: true, propertySatisfied: true, entityMatched: true, sourceOwnerSatisfied: true, confidence: 1 },
    conflicts: [], answerPolicy,
  };
}

const resume = item('resume:cedar-falcon', 'profile_resume', 'cedar-falcon');
const projects = item('projects:natively', 'profile_project', 'natively');
const jd = item('jd:session-recovery-pipeline', 'profile_jd', 'session-recovery-pipeline');
const reference = item('reference:mercury-x1', 'mode_reference_chunk', 'mercury-x1');

function finalValidate({ decision, pack: evidencePack, finalUserPrompt }) {
  return validateFinalPromptEvidence({
    decision,
    contract,
    pack: evidencePack,
    manifest: buildRenderedEvidenceManifest(evidencePack),
    finalUserPrompt,
  });
}

function decisionFromRequest(allowedSourceKinds, request) {
  return resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile', 'job_description', 'reference_files'],
    },
    explicitRequest: request,
    explicitRequests: [request],
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
}

test('resume + JD comparison requires both families in the final prompt', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequests: ['profile', 'job_description'],
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
  // Pack includes projects because the 'profile' request grants both
  // profile_resume AND projects (turnSourceDecision.ts: profileKinds()).
  const p = pack([resume, projects, jd]);
  const rendered = '<evidence id="resume:cedar-falcon" /><evidence id="projects:natively" /><evidence id="jd:session-recovery-pipeline" />';
  const result = finalValidate({ decision, pack: p, finalUserPrompt: rendered });
  assert.equal(result.ok, true);
  assert.equal(result.countsByFamily.resume, 1);
  assert.equal(result.countsByFamily.projects, 1);
  assert.equal(result.countsByFamily.job_description, 1);
});

test('a retrieved but prompt-dropped JD fails before dispatch', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile', 'job_description'],
    },
    explicitRequests: ['profile', 'job_description'],
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
  // Even rendering both résumé + projects, the JD is missing.
  const p = pack([resume, projects, jd]);
  const result = finalValidate({
    decision, pack: p,
    finalUserPrompt: '<evidence id="resume:cedar-falcon" /><evidence id="projects:natively" />',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'serialized_evidence_marker_missing');
});

test('JD-only final prompt rejects a leaked résumé family', () => {
  const decision = decisionFromRequest(['profile', 'job_description'], 'job_description');
  // Make it JD-only by removing 'profile' from allowed switches
  const jdOnlyDecision = resolveTurnSourceDecision({
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
  const p = pack([jd, resume]);
  const rendered = '<evidence id="jd:session-recovery-pipeline" /><evidence id="resume:cedar-falcon" />';
  const result = finalValidate({ decision: jdOnlyDecision, pack: p, finalUserPrompt: rendered });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'forbidden_evidence_rendered:profile_resume');
});

test('all-source assessment requires reference, résumé, projects, and JD evidence', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['reference_files', 'profile', 'job_description'],
    },
    explicitRequests: ['reference_files', 'profile', 'job_description'],
    availability: {
      hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
      hasLiveTranscript: false, hasMeetingRag: false,
    },
  });
  const p = pack([reference, resume, jd]);
  // Intentionally omit projects from the rendered prompt.
  const rendered = '<evidence id="reference:mercury-x1" /><evidence id="resume:cedar-falcon" /><evidence id="jd:session-recovery-pipeline" />';
  const result = finalValidate({ decision, pack: p, finalUserPrompt: rendered });
  // The `profile` request granted both profile_resume AND projects, so the
  // validator correctly identifies projects as missing from the rendered prompt.
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_required_evidence_family:projects');
});

test('manifest deduplicates repeated evidence IDs before counting a family', () => {
  const p = pack([jd, { ...jd }]);
  const manifest = buildRenderedEvidenceManifest(p);
  assert.deepEqual(manifest.evidenceIds, ['jd:session-recovery-pipeline']);
  assert.equal(manifest.countsByFamily.job_description, 1);
});

test('referent-only evidence never satisfies a required factual family', () => {
  const p = pack([{ ...jd, authority: 'referent_only' }]);
  const result = finalValidate({
    decision: { allowedEvidenceKinds: ['profile_jd'], requiredEvidenceKinds: ['profile_jd'] },
    pack: p,
    finalUserPrompt: '<evidence id="jd:session-recovery-pipeline" />',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_required_evidence_family:job_description');
});

test('refusal policy never proceeds to a provider packet', () => {
  const p = pack([], 'refuse_insufficient_evidence');
  const result = finalValidate({
    decision: { allowedEvidenceKinds: ['profile_jd'], requiredEvidenceKinds: ['profile_jd'] },
    pack: p,
    finalUserPrompt: '<evidence_pack />',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'answer_policy_refuse_insufficient_evidence');
});
