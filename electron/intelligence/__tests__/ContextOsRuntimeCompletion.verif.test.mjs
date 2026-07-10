// Context OS runtime-completion — behavioral tests for the new work:
//   • buildSourceClarification reflects only AVAILABLE universes (Phase 4)
//   • M3: custom_profile_notes cannot INDEPENDENTLY prove a candidate property
//   • EvidencePack now carries a stable packId (Phase 6/M4 substrate)
//
// Run: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsRuntimeCompletion.verif.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

// ── Phase 4: source-aware clarification ─────────────────────────────────────

test('buildSourceClarification offers ONLY the universes that exist', () => {
  // All three → three-way question.
  const all = co.buildSourceClarification({ hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: true });
  assert.match(all, /uploaded document/i);
  assert.match(all, /resume/i);
  assert.match(all, /meeting/i);

  // Document + meeting only (no profile) → must NOT mention resume.
  const docMeeting = co.buildSourceClarification({ hasReferenceFiles: true, hasProfileFacts: false, hasLiveTranscript: true });
  assert.match(docMeeting, /uploaded document/i);
  assert.match(docMeeting, /meeting/i);
  assert.ok(!/resume/i.test(docMeeting), 'must not offer resume when no profile exists');

  // Only one universe → generic ask, no invented options.
  const one = co.buildSourceClarification({ hasReferenceFiles: true, hasProfileFacts: false, hasLiveTranscript: false });
  assert.ok(!/meeting/i.test(one) && !/resume/i.test(one), 'single-universe clarification must not offer phantom options');
  assert.match(one, /which project do you mean/i);
});

test('clarification is deterministic and carries no entity/PII content', () => {
  const a = co.buildSourceClarification({ hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: true });
  const b = co.buildSourceClarification({ hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: true });
  assert.equal(a, b);
});

// ── M3: custom_profile_notes corroboration requirement ──────────────────────

function item(overrides) {
  return {
    evidenceId: overrides.evidenceId ?? 'e', sourceKind: overrides.sourceKind, sourceId: 's',
    sourceOwner: 'profile', authority: 'evidence', trustLevel: overrides.trustLevel ?? 'profile_unverified',
    text: overrides.text, supports: { property: 'unknown' }, score: { final: 0.5 }, reasonIncluded: 't',
  };
}
function pack(items, property) {
  return { packId: 'p1', version: 1, turnId: 't', sourceOwner: 'profile', requestedProperty: property, items, rejected: [], conflicts: [], answerPolicy: 'answer',
    coverage: { hasDirectEvidence: true, propertySatisfied: true, entityMatched: true, sourceOwnerSatisfied: true, confidence: 0.5 } };
}

test('M3: custom_profile_notes ALONE cannot prove candidate_experience', () => {
  const notesOnly = pack([
    item({ evidenceId: 'n1', sourceKind: 'custom_profile_notes', text: 'I have 8 years of experience with distributed systems.' }),
  ], 'candidate_experience');
  const v = co.validateEvidenceForProperty(notesOnly);
  assert.equal(v.ok, false, 'notes-only proof of candidate experience must be rejected');
  assert.ok(v.rejectedEvidenceIds.includes('n1'));
});

test('M3: custom_profile_notes CORROBORATED by structured resume is accepted', () => {
  const corroborated = pack([
    item({ evidenceId: 'n1', sourceKind: 'custom_profile_notes', text: '8 years experience with distributed systems.' }),
    item({ evidenceId: 'r1', sourceKind: 'profile_resume', trustLevel: 'profile_verified', text: 'Senior engineer, 8 years experience building distributed systems at scale.' }),
  ], 'candidate_experience');
  const v = co.validateEvidenceForProperty(corroborated);
  assert.equal(v.ok, true, 'corroborated notes must be accepted');
  assert.ok(v.usableEvidenceIds.includes('r1'));
});

test('M3: structured resume ALONE still proves candidate_experience (no regression)', () => {
  const resumeOnly = pack([
    item({ evidenceId: 'r1', sourceKind: 'profile_resume', trustLevel: 'profile_verified', text: '8 years experience with distributed systems.' }),
  ], 'candidate_experience');
  assert.equal(co.validateEvidenceForProperty(resumeOnly).ok, true);
});

test('M3: notes CAN still prove a NON-candidate property (only candidate props are gated)', () => {
  const notesFunding = pack([
    item({ evidenceId: 'n1', sourceKind: 'custom_profile_notes', text: 'The project was funded by a seed grant.' }),
  ], 'funding_source');
  // funding_source is not a candidate property → notes are allowed to prove it.
  assert.equal(co.validateEvidenceForProperty(notesFunding).ok, true);
});

// ── Phase 6: EvidencePack packId identity ───────────────────────────────────

test('EvidenceOrchestrator stamps a stable packId + version', async () => {
  const kernel = new co.SourceAuthorityKernel();
  const contract = kernel.build({
    surface: 'manual_chat', question: 'What are the four phases of the project?', activeModeId: 'm1',
    sourceAuthority: 'reference_files_only', answerShape: 'list', voicePerspective: 'assistant_explanation',
    enforcement: 'enforce', hasReferenceFiles: true, hasProfileFacts: false, hasLiveTranscript: false,
  });
  const orch = new co.EvidenceOrchestrator();
  const p = await orch.buildEvidencePack({ question: 'phases', contract, retrievers: { retrieveModeContext: () => 'The methodology comprises four phases.' } });
  assert.ok(p.packId, 'pack must carry a packId');
  assert.equal(p.packId, `${contract.turnId}:pack:1`);
  assert.equal(p.version, 1);
});
