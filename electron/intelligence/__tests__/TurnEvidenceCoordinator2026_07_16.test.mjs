// Multi-family evidence coordination and starvation prevention (2026-07-16).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { TurnEvidenceCoordinator, allocateRequiredEvidenceFamilies } = require(
  path.join(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'),
);

const contract = {
  turnId: 'coordinator-turn', surface: 'manual_chat', activeModeId: 'mode-1', activeModeName: 'Fixture',
  answerShape: 'comparison', sourceOwner: 'mixed', requestedProperty: 'unknown', voicePerspective: 'first_person_candidate',
  allowedSources: [], forbiddenSources: [], referentOnlySources: [], conflictPolicy: 'ask_clarification',
  memoryReadPolicy: { allowHindsight: false, allowPriorAssistantFacts: false, allowPriorAssistantReferents: true },
  memoryWritePolicy: { allowAssistantMessage: true, allowVerifiedClaims: true, allowUnverifiedClaims: false },
  enforcement: 'enforce', reason: 'fixture',
};

function item(id, sourceKind, score = 1) {
  return {
    evidenceId: id, sourceKind, sourceId: id, sourceOwner: sourceKind.startsWith('mode_') ? 'reference_files' : 'profile',
    authority: 'evidence', trustLevel: 'user_uploaded', text: id, supports: { property: 'unknown' },
    score: { final: score }, reasonIncluded: 'fixture',
  };
}

function pack(items) {
  return {
    packId: 'fixture-pack', turnId: contract.turnId, sourceOwner: 'mixed', requestedProperty: 'unknown', items,
    rejected: [], coverage: { hasDirectEvidence: true, propertySatisfied: true, entityMatched: true, sourceOwnerSatisfied: true, confidence: 1 },
    conflicts: [], answerPolicy: 'answer',
  };
}

const allDecision = {
  outcome: 'explicit_granted', owner: 'mixed', explicitRequest: 'reference_files',
  requiredEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
  allowedEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
};

test('allocation reserves résumé, project, and JD despite verbose high-score reference evidence', () => {
  const references = Array.from({ length: 12 }, (_, i) => item(`reference:${i}`, 'mode_reference_chunk', 100 - i));
  const allocated = allocateRequiredEvidenceFamilies({
    items: [...references, item('resume:cedar', 'profile_resume', 0.1), item('project:cedar', 'profile_project', 0.1), item('jd:lattice', 'profile_jd', 0.1)],
    requiredKinds: allDecision.requiredEvidenceKinds,
    maxItems: 4,
  });
  assert.deepEqual(allocated.missingKinds, []);
  assert.deepEqual(new Set(allocated.items.map((i) => i.sourceKind)), new Set([
    'mode_reference_chunk', 'profile_resume', 'profile_project', 'profile_jd',
  ]));
});

test('coordinator retrieves reference and profile families concurrently then keeps every required family', async () => {
  const calls = [];
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: allDecision,
    contract,
    retrieveReferenceEvidence: async () => { calls.push('reference'); return pack([item('reference:amber', 'mode_reference_chunk')]); },
    retrieveProfileEvidence: async () => { calls.push('profile'); return pack([item('resume:cedar', 'profile_resume'), item('project:cedar', 'profile_project'), item('jd:lattice', 'profile_jd')]); },
  });
  assert.deepEqual(new Set(calls), new Set(['reference', 'profile']));
  assert.equal(result.failures.length, 0);
  assert.equal(result.pack.answerPolicy, 'answer');
  assert.deepEqual(new Set(result.pack.items.map((i) => i.sourceKind)), new Set([
    'mode_reference_chunk', 'profile_resume', 'profile_project', 'profile_jd',
  ]));
});

test('coordinator fails closed when a required project family is absent', async () => {
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: allDecision,
    contract,
    retrieveReferenceEvidence: async () => pack([item('reference:amber', 'mode_reference_chunk')]),
    retrieveProfileEvidence: async () => pack([item('resume:cedar', 'profile_resume'), item('jd:lattice', 'profile_jd')]),
  });
  assert.equal(result.pack.answerPolicy, 'refuse_insufficient_evidence');
  assert.deepEqual(result.failures, [{ family: 'projects', reason: 'required_family_starved' }]);
});
