// Context OS Phase 1 — core types + contract helpers + trace privacy.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsTypes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron');
assert.ok(
  fs.existsSync(path.resolve(distDir, 'electron/intelligence/context-os/index.js')),
  'dist-electron missing — run npm run build:electron first',
);

const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(distDir, 'electron/intelligence/context-os/index.js'));

// ── Fixtures ────────────────────────────────────────────────────────────────

function cap(sourceKind, authority, overrides = {}) {
  return {
    sourceKind,
    scopeId: null,
    authority,
    permissions: {
      retrieve: authority !== 'forbidden',
      quote: authority === 'evidence',
      useAsEvidence: authority === 'evidence',
      useForReferentResolution: authority === 'referent_only' || authority === 'evidence',
      writeBackToMemory: false,
      ...(overrides.permissions || {}),
    },
    trustLevel: overrides.trustLevel ?? 'user_uploaded',
    pii: overrides.pii ?? false,
    issuedBy: 'SourceAuthorityKernel',
    reason: overrides.reason ?? 'test',
  };
}

const contract = {
  allowedSources: [
    cap('mode_reference_chunk', 'evidence'),
    cap('live_transcript', 'referent_only'),
    cap('custom_mode_prompt', 'instruction'),
  ],
};

// ── Contract helpers ────────────────────────────────────────────────────────

test('capabilityFor finds granted kinds and returns null otherwise', () => {
  assert.ok(co.capabilityFor(contract, 'mode_reference_chunk'));
  assert.equal(co.capabilityFor(contract, 'profile_resume'), null);
});

test('allowsEvidence: only authority=evidence with useAsEvidence', () => {
  assert.equal(co.allowsEvidence(contract, 'mode_reference_chunk'), true);
  assert.equal(co.allowsEvidence(contract, 'live_transcript'), false);
  assert.equal(co.allowsEvidence(contract, 'custom_mode_prompt'), false);
  assert.equal(co.allowsEvidence(contract, 'profile_resume'), false);
});

test('isReferentOnly distinguishes referent grants from evidence grants', () => {
  assert.equal(co.isReferentOnly(contract, 'live_transcript'), true);
  assert.equal(co.isReferentOnly(contract, 'mode_reference_chunk'), false);
});

test('allowsRetrieval: any non-forbidden grant permits retrieval; absent kinds do not', () => {
  assert.equal(co.allowsRetrieval(contract, 'live_transcript'), true);
  assert.equal(co.allowsRetrieval(contract, 'hindsight_memory'), false);
});

// ── Source kind families ────────────────────────────────────────────────────

test('source kind family sets partition without overlap between profile and reference', () => {
  const profile = new Set(co.PROFILE_SOURCE_KINDS);
  for (const k of co.REFERENCE_SOURCE_KINDS) assert.equal(profile.has(k), false, `${k} in both families`);
  assert.equal(co.isProfileSourceKind('profile_resume'), true);
  assert.equal(co.isProfileSourceKind('mode_reference_file'), false);
  assert.equal(co.isMemorySourceKind('hindsight_memory'), true);
  assert.equal(co.isMemorySourceKind('live_transcript'), false);
});

test('ALL_SOURCE_KINDS covers every family member exactly once', () => {
  const all = new Set(co.ALL_SOURCE_KINDS);
  assert.equal(all.size, co.ALL_SOURCE_KINDS.length, 'duplicates in ALL_SOURCE_KINDS');
  for (const fam of [co.PROFILE_SOURCE_KINDS, co.REFERENCE_SOURCE_KINDS, co.TRANSCRIPT_SOURCE_KINDS, co.MEMORY_SOURCE_KINDS, co.UNTRUSTED_CAPTURE_KINDS]) {
    for (const k of fam) assert.ok(all.has(k), `${k} missing from ALL_SOURCE_KINDS`);
  }
});

test('legacyKindsFor maps every canonical kind onto legacy contract kinds', () => {
  for (const k of co.ALL_SOURCE_KINDS) {
    const legacy = co.legacyKindsFor(k);
    assert.ok(Array.isArray(legacy) && legacy.length > 0, `no legacy mapping for ${k}`);
  }
  assert.deepEqual(co.legacyKindsFor('prior_assistant_claim'), ['prior_assistant_facts']);
  assert.deepEqual(co.legacyKindsFor('hindsight_memory'), ['long_term_memory']);
});

// ── EvidencePack helpers ────────────────────────────────────────────────────

test('emptyEvidencePack has zero coverage and the requested policy', () => {
  const pack = co.emptyEvidencePack({
    turnId: 't1',
    sourceOwner: 'clarify',
    requestedProperty: 'unknown',
    answerPolicy: 'ask_clarification',
  });
  assert.equal(pack.answerPolicy, 'ask_clarification');
  assert.equal(pack.coverage.hasDirectEvidence, false);
  assert.equal(pack.items.length, 0);
});

test('evidenceOnlyItems filters out referent-only items', () => {
  const items = [
    { authority: 'evidence', evidenceId: 'a' },
    { authority: 'referent_only', evidenceId: 'b' },
  ];
  const out = co.evidenceOnlyItems({ items });
  assert.deepEqual(out.map((i) => i.evidenceId), ['a']);
});

test('previewText caps length and collapses whitespace', () => {
  const long = 'x'.repeat(500);
  assert.equal(co.previewText(long).length, 80);
  assert.equal(co.previewText('  a\n\nb   c '), 'a b c');
  assert.equal(co.previewText(null), '');
});

// ── Trace privacy ───────────────────────────────────────────────────────────

test('buildContextOsTrace never includes evidence text and caps the question preview', () => {
  const fullContract = {
    turnId: 't2',
    surface: 'manual_chat',
    activeModeId: 'mode-1',
    activeModeName: 'Seminar',
    answerShape: 'list',
    sourceOwner: 'reference_files',
    requestedProperty: 'phase_or_stage',
    voicePerspective: 'assistant_explanation',
    allowedSources: [cap('mode_reference_chunk', 'evidence')],
    forbiddenSources: ['profile_resume'],
    referentOnlySources: ['live_transcript'],
    conflictPolicy: 'reference_files_win',
    memoryReadPolicy: { allowHindsight: false, allowPriorAssistantFacts: false, allowPriorAssistantReferents: true },
    memoryWritePolicy: { allowAssistantMessage: true, allowVerifiedClaims: true, allowUnverifiedClaims: false },
    enforcement: 'observe',
    reason: 'test',
  };
  const SECRET = 'SECRET_RESUME_CONTENT_MUST_NOT_APPEAR';
  const pack = {
    turnId: 't2',
    sourceOwner: 'reference_files',
    requestedProperty: 'phase_or_stage',
    items: [{
      evidenceId: 'e1', sourceKind: 'mode_reference_chunk', sourceId: 'f1',
      sourceOwner: 'reference_files', authority: 'evidence', trustLevel: 'user_uploaded',
      text: SECRET, supports: { property: 'phase_or_stage' }, score: { final: 0.9 },
      reasonIncluded: 'test',
    }],
    rejected: [{ sourceKind: 'profile_resume', reason: 'forbidden_source' }],
    coverage: { hasDirectEvidence: true, propertySatisfied: true, entityMatched: true, sourceOwnerSatisfied: true, confidence: 0.9 },
    conflicts: [],
    answerPolicy: 'answer',
  };
  const trace = co.buildContextOsTrace({
    contract: fullContract,
    sourceAuthority: 'reference_files_only',
    question: 'What are the four phases of the project? '.repeat(10),
    evidencePack: pack,
    finalAction: 'answer',
  });
  const serialized = JSON.stringify(trace);
  assert.ok(!serialized.includes(SECRET), 'trace leaked evidence text');
  assert.ok(trace.questionPreview.length <= 80);
  assert.deepEqual(trace.usedSources, ['mode_reference_chunk']);
  assert.deepEqual(trace.rejectedSources, [{ sourceKind: 'profile_resume', reason: 'forbidden_source' }]);
  assert.equal(trace.evidenceCoverage.propertySatisfied, true);
  assert.equal(trace.finalAction, 'answer');
});
