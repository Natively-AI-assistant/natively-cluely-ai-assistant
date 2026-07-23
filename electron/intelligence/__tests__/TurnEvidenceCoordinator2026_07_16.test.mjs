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

test('allocation enforces a total character budget without dropping required-kind reservations', () => {
  const oversized = (id) => item(id, 'mode_reference_chunk', 0.9, 'x'.repeat(4000));
  const required = item('resume:cedar', 'profile_resume', 0.5, 'x'.repeat(200));
  const requiredProject = item('project:cedar', 'profile_project', 0.5, 'x'.repeat(200));
  const requiredJd = item('jd:lattice', 'profile_jd', 0.5, 'x'.repeat(200));
  const allocated = allocateRequiredEvidenceFamilies({
    items: [
      oversized('reference:big-1'),
      oversized('reference:big-2'),
      oversized('reference:big-3'),
      required,
      requiredProject,
      requiredJd,
    ],
    requiredKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
    maxItems: 6,
    maxChars: 1500,
  });
  assert.deepEqual(allocated.missingKinds, []);
  // Required kinds MUST remain even when they alone blow the budget; the cap
  // only bounds additional top-up evidence after reservation.
  const selectedKinds = new Set(allocated.items.map((i) => i.sourceKind));
  assert.ok(selectedKinds.has('profile_resume'));
  assert.ok(selectedKinds.has('profile_project'));
  assert.ok(selectedKinds.has('profile_jd'));
  const totalChars = allocated.items.reduce((acc, i) => acc + (i.text?.length ?? 0), 0);
  assert.ok(totalChars <= 1500 + 600, `reserved evidence (${totalChars} chars) may not exceed cap+reservation headroom significantly`);
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
  assert.equal(Object.isFrozen(result.pack), true, 'the canonical result pack must be immutable');
  assert.equal(Object.isFrozen(result.pack.items), true, 'item selection must not be mutable after resolution');
  assert.equal(Object.isFrozen(result.pack.items[0]), true, 'each selected evidence item must be immutable');
  assert.throws(() => result.pack.items.push(item('late', 'profile_resume')), TypeError);
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

test('coordinator refuses when selected evidence does not satisfy the requested property', async () => {
  const fundingContract = {
    ...contract,
    requestedProperty: 'funding_source',
  };
  const referenceOnlyDecision = {
    ...allDecision,
    requiredEvidenceKinds: ['reference_files'],
    allowedEvidenceKinds: ['reference_files'],
  };
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: referenceOnlyDecision,
    contract: fundingContract,
    retrieveReferenceEvidence: async () => pack([
      { ...item('reference:collab', 'mode_reference_chunk'), supports: { property: 'unknown' } },
    ]),
  });
  assert.equal(result.pack.answerPolicy, 'refuse_insufficient_evidence');
  assert.equal(result.pack.coverage.propertySatisfied, false);
  assert.equal(result.pack.coverage.hasDirectEvidence, true);
});

test('a thrown profile retriever does not discard already-retrieved reference evidence', async () => {
  const referenceOnlyDecision = {
    ...allDecision,
    requiredEvidenceKinds: ['reference_files'],
    allowedEvidenceKinds: ['reference_files'],
  };
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: referenceOnlyDecision,
    contract,
    retrieveReferenceEvidence: async () => pack([item('reference:amber', 'mode_reference_chunk')]),
    retrieveProfileEvidence: async () => { throw new Error('profile source down'); },
  });
  assert.equal(result.failures.length, 0);
  assert.equal(result.pack.items.some((i) => i.sourceKind === 'mode_reference_chunk'), true);
  assert.equal(result.pack.answerPolicy, 'answer');
});

test('a required family whose retriever throws is reported as starved, not a full-turn rejection', async () => {
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: allDecision,
    contract,
    retrieveReferenceEvidence: async () => pack([item('reference:amber', 'mode_reference_chunk')]),
    retrieveProfileEvidence: async () => { throw new Error('profile source down'); },
  });
  assert.equal(result.pack.answerPolicy, 'refuse_insufficient_evidence');
  assert.ok(result.failures.some((f) => f.family === 'resume'));
});

test('maxItems is a soft cap: required-kind reservations always survive', () => {
  const allocated = allocateRequiredEvidenceFamilies({
    items: [
      item('reference:a', 'mode_reference_chunk', 1),
      item('reference:b', 'mode_reference_chunk', 1),
      item('resume:cedar', 'profile_resume', 0.1),
      item('project:cedar', 'profile_project', 0.1),
      item('jd:lattice', 'profile_jd', 0.1),
    ],
    requiredKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
    maxItems: 2,
  });
  assert.deepEqual(allocated.missingKinds, []);
  assert.ok(allocated.items.length >= 4, 'all 4 required-kind reservations must survive despite maxItems=2');
});

test('coordinator no longer starves projects when ProfileEvidenceService emits profile_project items', async () => {
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: allDecision,
    contract,
    retrieveReferenceEvidence: async () => pack([item('reference:amber', 'mode_reference_chunk')]),
    retrieveProfileEvidence: async () => pack([
      item('resume:cedar', 'profile_resume'),
      item('project:cedar', 'profile_project'),
      item('jd:lattice', 'profile_jd'),
    ]),
  });
  assert.equal(result.failures.length, 0);
  assert.ok(result.pack.items.some((i) => i.sourceKind === 'profile_project'));
  assert.equal(result.pack.answerPolicy, 'answer');
});
