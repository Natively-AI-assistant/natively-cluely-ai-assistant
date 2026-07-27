// electron/intelligence/context-os/__tests__/EvidencePackValidation2026_07_28.test.mjs
//
// Answer-pipeline-rebuild Phase 2 (docs/answer-pipeline-rebuild/
// 03_EVIDENCEPACK_DESIGN.md) — Stage 0 shadow validator,
// checkImpossibleEvidenceState. Covers ONLY the forbidden-direction checks
// (#1/#2 in the design doc) that Stage 0 scopes; required-direction (#3) is
// deliberately out of scope here — see the design doc's asymmetric-staging
// rationale (RC-8, a live false-refusal bug found the same session, is why
// that direction must not be enforced before its own dedicated shadow
// period).
//
// Requires: npm run build:electron:tsc (or build:electron).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const { checkImpossibleEvidenceState } = require(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/evidencePackValidation.js'),
);
const { emptyEvidencePack } = require(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/evidencePack.js'),
);

const profileItem = (overrides = {}) => ({
  evidenceId: 'e1',
  sourceKind: 'profile_resume',
  sourceId: 's',
  sourceOwner: 'profile',
  authority: 'evidence',
  trustLevel: 'profile_verified',
  text: '5 years of experience as a backend engineer',
  supports: { property: 'unknown' },
  score: { final: 0.9 },
  reasonIncluded: 'deterministic profile evidence selection',
  ...overrides,
});

const packWith = (items, requestedProperty = 'unknown') => ({
  packId: 't1:pack:1',
  turnId: 't1',
  sourceOwner: 'profile',
  requestedProperty,
  items,
  rejected: [],
  coverage: { hasDirectEvidence: items.length > 0, propertySatisfied: false, entityMatched: items.length > 0, sourceOwnerSatisfied: true, confidence: items.length > 0 ? 0.9 : 0 },
  conflicts: [],
  answerPolicy: items.length > 0 ? 'answer' : 'refuse_insufficient_evidence',
});

describe('checkImpossibleEvidenceState — forbidden direction (check #1)', () => {
  test('forbidden policy + profile-family evidence item present -> violation', () => {
    const r = checkImpossibleEvidenceState(packWith([profileItem()]), 'forbidden');
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].code, 'forbidden_policy_profile_item_present');
  });

  test('forbidden policy + empty pack -> ok', () => {
    const r = checkImpossibleEvidenceState(
      emptyEvidencePack({ turnId: 't2', sourceOwner: 'profile', requestedProperty: 'unknown', answerPolicy: 'refuse_insufficient_evidence' }),
      'forbidden',
    );
    assert.equal(r.ok, true);
    assert.equal(r.violations.length, 0);
  });

  test('forbidden policy + a non-profile-family evidence item -> ok (only profile-family kinds are checked)', () => {
    const r = checkImpossibleEvidenceState(
      packWith([profileItem({ sourceKind: 'live_transcript', sourceOwner: 'transcript' })]),
      'forbidden',
    );
    assert.equal(r.ok, true);
  });

  test('forbidden policy + a referent_only (not evidence-authority) profile item -> ok (not admitted as fact)', () => {
    const r = checkImpossibleEvidenceState(
      packWith([profileItem({ authority: 'referent_only' })]),
      'forbidden',
    );
    assert.equal(r.ok, true);
  });
});

describe('checkImpossibleEvidenceState — allowed direction, relevance admission (check #2, the RC-1/RC-9 closer)', () => {
  test('RC-9 exact shape: allowed policy + requestedProperty=unknown + profile item present -> violation', () => {
    // This is exactly the case2c_dependency_injection mechanism: a generic
    // technical question has no candidate-specific property to ask about, so
    // requestedProperty is legitimately 'unknown' — meaning NO affirmative
    // reason can ever be constructed for including profile evidence. Before
    // AnswerPlanner's RC-9 fix, this classified as unknown_answer/allowed and
    // this check would have caught the leak at pack-construction time,
    // independent of whether the vocabulary gap had been found yet.
    const r = checkImpossibleEvidenceState(packWith([profileItem()], 'unknown'), 'allowed');
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].code, 'allowed_policy_unrelated_profile_item');
  });

  test('allowed policy + requestedProperty set + item text genuinely supports it -> ok', () => {
    const r = checkImpossibleEvidenceState(
      packWith([profileItem({ supports: { property: 'candidate_experience' } })], 'candidate_experience'),
      'allowed',
    );
    assert.equal(r.ok, true);
  });

  test('allowed policy + requestedProperty set + item text does NOT actually support it -> violation (defense in depth: re-derives support from text, does not just trust the pre-set supports.property field)', () => {
    const r = checkImpossibleEvidenceState(
      packWith([profileItem({ text: 'unrelated filler text with no property signal', supports: { property: 'candidate_experience' } })], 'candidate_experience'),
      'allowed',
    );
    assert.equal(r.ok, false);
    assert.equal(r.violations[0].code, 'allowed_policy_unrelated_profile_item');
  });

  test('allowed policy + empty pack -> ok', () => {
    const r = checkImpossibleEvidenceState(packWith([], 'unknown'), 'allowed');
    assert.equal(r.ok, true);
  });
});

describe('checkImpossibleEvidenceState — required direction is explicitly out of scope for Stage 0', () => {
  test('required policy + profile item present -> ok (no check applied; this is the expected case, not a violation)', () => {
    const r = checkImpossibleEvidenceState(packWith([profileItem()]), 'required');
    assert.equal(r.ok, true);
  });

  test('required policy + empty pack -> ok (check #3, empty-required, is deliberately NOT implemented here — see design doc)', () => {
    const r = checkImpossibleEvidenceState(packWith([], 'unknown'), 'required');
    assert.equal(r.ok, true);
  });
});
