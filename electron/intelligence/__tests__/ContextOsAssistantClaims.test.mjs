// Context OS Phase 9 — assistant claims memory safety.
//
// The invariants:
//   • assistant text is not evidence by default
//   • claims start unverified; only verified+evidence-backed reuse is possible
//   • no default contract allows prior-assistant facts → reuse is structurally OFF
//   • a prior wrong claim is detected as contradicted by newer evidence (Scenario E)
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsAssistantClaims.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

function evidenceItem(text, id = 'e1') {
  return {
    evidenceId: id, sourceKind: 'mode_reference_chunk', sourceId: 'f1',
    sourceOwner: 'reference_files', authority: 'evidence', trustLevel: 'user_uploaded',
    text, supports: { property: 'unknown' }, score: { final: 0.5 }, reasonIncluded: 'test',
  };
}

// ── Claim extraction ────────────────────────────────────────────────────────

test('extractCandidateClaims keeps factual sentences, drops scaffolding + code', () => {
  const answer = [
    'Sure, let me explain.',
    'The system uses NVIDIA Jetson Orin Nano as the compute controller.',
    'The dataset contains 12,000 demonstrations across four tasks.',
    'Okay, here is the code:',
    '```python\nprint("not a claim about the world")\n```',
    'Thanks!',
  ].join(' ');
  const claims = co.extractCandidateClaims(answer);
  assert.equal(claims.length, 2, `got: ${JSON.stringify(claims)}`);
  assert.match(claims[0], /Jetson Orin Nano/);
  assert.match(claims[1], /12,000 demonstrations/);
});

// ── Verification ────────────────────────────────────────────────────────────

test('claim covered by evidence → verified with evidence pointers', () => {
  const pack = { items: [evidenceItem('The robot uses the NVIDIA Jetson Orin Nano as its compute controller for perception.')] };
  const v = co.verifyClaimAgainstEvidence('The system uses NVIDIA Jetson Orin Nano as the compute controller.', pack);
  assert.equal(v.status, 'verified');
  assert.deepEqual(v.evidenceIds, ['e1']);
});

test('claim NOT covered by evidence → unverified with no pointers', () => {
  const pack = { items: [evidenceItem('The methodology comprises four phases: requirements, design, implementation, evaluation.')] };
  const v = co.verifyClaimAgainstEvidence('The system uses an ESP32 microcontroller for actuation.', pack);
  assert.equal(v.status, 'unverified');
  assert.deepEqual(v.evidenceIds, []);
});

test('referent-only items can never verify a claim', () => {
  const item = { ...evidenceItem('The system uses NVIDIA Jetson Orin Nano as the compute controller.'), authority: 'referent_only' };
  const v = co.verifyClaimAgainstEvidence('The system uses NVIDIA Jetson Orin Nano as the compute controller.', { items: [item] });
  assert.equal(v.status, 'unverified');
});

// ── Reuse gate ──────────────────────────────────────────────────────────────

const kernel = new co.SourceAuthorityKernel();
const docContract = kernel.build({
  surface: 'manual_chat', question: 'What controller does the system use?',
  activeModeId: 'm1', sourceAuthority: 'reference_files_only', answerShape: 'general',
  voicePerspective: 'assistant_explanation', enforcement: 'observe',
  hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: false,
});

test('REUSE IS STRUCTURALLY OFF: even a verified claim is not reusable under any default contract', () => {
  const claim = { validationStatus: 'verified', evidenceIds: ['e1'], sourceOwner: 'reference_files' };
  assert.equal(co.claimReusableAsEvidence(claim, docContract), false,
    'default contracts never read prior-assistant facts');
});

test('unverified claims are never reusable, even under a permissive future contract', () => {
  const permissive = { ...docContract, memoryReadPolicy: { ...docContract.memoryReadPolicy, allowPriorAssistantFacts: true } };
  assert.equal(co.claimReusableAsEvidence({ validationStatus: 'unverified', evidenceIds: ['e1'], sourceOwner: 'reference_files' }, permissive), false);
  assert.equal(co.claimReusableAsEvidence({ validationStatus: 'verified', evidenceIds: [], sourceOwner: 'reference_files' }, permissive), false);
  // Verified + pointers + explicit grant + matching owner → the ONLY reusable shape.
  assert.equal(co.claimReusableAsEvidence({ validationStatus: 'verified', evidenceIds: ['e1'], sourceOwner: 'reference_files' }, permissive), true);
  // Owner mismatch blocks reuse (profile claim can't feed a doc turn).
  assert.equal(co.claimReusableAsEvidence({ validationStatus: 'verified', evidenceIds: ['e1'], sourceOwner: 'profile' }, permissive), false);
});

// ── Contradiction (Scenario E) ──────────────────────────────────────────────

test('SCENARIO E: prior "ESP32" claim is contradicted by current Jetson evidence', () => {
  const pack = { items: [evidenceItem('The system uses NVIDIA Jetson Orin Nano as the compute controller.')] };
  assert.equal(co.claimContradictedByEvidence({ claimText: 'The project uses ESP32.' }, pack), true);
});

test('a prior claim consistent with current evidence is NOT contradicted', () => {
  const pack = { items: [evidenceItem('The system uses NVIDIA Jetson Orin Nano as the compute controller.')] };
  assert.equal(co.claimContradictedByEvidence({ claimText: 'The controller is the Jetson Orin Nano board.' }, pack), false);
});

test('no evidence → no contradiction verdict (fail-safe)', () => {
  assert.equal(co.claimContradictedByEvidence({ claimText: 'The project uses ESP32.' }, { items: [] }), false);
});

// ── buildAssistantClaims end-to-end ─────────────────────────────────────────

test('buildAssistantClaims stamps turn/owner/property and splits verified vs unverified', () => {
  const pack = { items: [evidenceItem('The methodology comprises four phases: requirements, design, implementation, and evaluation.')] };
  const claims = co.buildAssistantClaims({
    answer: 'The methodology comprises four phases: requirements, design, implementation, and evaluation. The robot costs $99,999 according to my estimate.',
    contract: { turnId: 't9', sourceOwner: 'reference_files', requestedProperty: 'phase_or_stage' },
    evidencePack: pack,
  });
  assert.equal(claims.length, 2);
  assert.equal(claims[0].validationStatus, 'verified');
  assert.ok(claims[0].evidenceIds.length > 0);
  assert.equal(claims[1].validationStatus, 'unverified');
  assert.equal(claims[1].evidenceIds.length, 0);
  for (const c of claims) {
    assert.equal(c.turnId, 't9');
    assert.equal(c.sourceOwner, 'reference_files');
    assert.equal(c.requestedProperty, 'phase_or_stage');
  }
});

// ── Wiring + schema ─────────────────────────────────────────────────────────

test('WIRING: manual chat persists VERIFIED claims via buildAssistantClaims (H3)', () => {
  const ipcSource = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  assert.ok(ipcSource.includes("contextOsMemorySafetyEnabled"), 'memory safety flag not consulted');
  assert.ok(ipcSource.includes('saveAssistantClaim'), 'claim persistence not wired');
  assert.ok(ipcSource.includes('saveTurnContextContract'), 'contract snapshot not wired');
  // H3: claims are now VERIFIED against the captured evidence block via
  // buildAssistantClaims — not blindly stamped 'unverified'.
  assert.ok(ipcSource.includes('buildAssistantClaims'), 'claims must be verified via buildAssistantClaims');
  assert.ok(ipcSource.includes('capturedEvidenceBlock'), 'the exact generation evidence must be captured for verification');
});

test('DAO fail-closed: saveAssistantClaim downgrades verified-without-evidence (H3, source guard)', () => {
  const dbSource = fs.readFileSync(path.resolve(repoRoot, 'electron/db/DatabaseManager.ts'), 'utf8');
  assert.match(dbSource, /verified.{0,40}evidenceIds\.length === 0/s, 'DAO must guard verified-without-evidence');
  assert.match(dbSource, /downgrad/i, 'DAO must downgrade rather than store an unprovable verified claim');
});

test('SCHEMA: v24 migration creates assistant_claims + turn_context_contracts', () => {
  const dbSource = fs.readFileSync(path.resolve(repoRoot, 'electron/db/DatabaseManager.ts'), 'utf8');
  assert.match(dbSource, /version < 24/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS assistant_claims/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS turn_context_contracts/);
  assert.match(dbSource, /validation_status TEXT NOT NULL DEFAULT 'unverified'/);
  assert.match(dbSource, /user_version = 24/);
});
