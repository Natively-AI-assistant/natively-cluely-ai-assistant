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

describe('Stage 1 enforcement filter (code-review finding, 2026-07-28): check #2 must be observed but never enforced', () => {
  // Reproduces the reviewer's live finding: "familiar with graphql" (ordinary
  // second-person skill phrasing) misclassifies as unknown_answer/allowed
  // with requestedProperty left 'unknown' (detectRequestedProperty only
  // recognizes narrow first-person-possessive phrasing like "my
  // experience"). The candidate's résumé genuinely lists GraphQL as a
  // skill — this is a real, high-confidence, correctly-selected evidence
  // item, not noise. Check #2 still flags it (requestedProperty==='unknown'
  // means no affirmative reason can ever be constructed, by design), but
  // ipcHandlers.ts's Stage 1 gate must filter this violation out before
  // deciding to block, or it would suppress a legitimate profile answer —
  // the same RC-8-shaped risk class, reached via 'allowed' instead of
  // 'required'.
  const graphqlSkillPack = packWith(
    [profileItem({ text: 'Skills: GraphQL, Node.js, PostgreSQL', supports: { property: 'unknown' }, score: { propertyMatch: 1, final: 0.9 } })],
    'unknown',
  );

  test('check #2 still flags it in shadow observation (Stage 0 must keep seeing this data)', () => {
    const r = checkImpossibleEvidenceState(graphqlSkillPack, 'allowed');
    assert.equal(r.ok, false);
    assert.equal(r.violations[0].code, 'allowed_policy_unrelated_profile_item');
  });

  test('the Stage 1 enforcement filter (forbidden_policy_profile_item_present only) does NOT enforce this violation', () => {
    const r = checkImpossibleEvidenceState(graphqlSkillPack, 'allowed');
    const enforceableViolations = r.violations.filter((v) => v.code === 'forbidden_policy_profile_item_present');
    assert.equal(enforceableViolations.length, 0, 'the GraphQL skill match must not be blocked by Stage 1 — only check #1 is enforced');
  });

  test('a genuine forbidden-direction leak (check #1) IS enforced by the same filter', () => {
    const r = checkImpossibleEvidenceState(packWith([profileItem()]), 'forbidden');
    const enforceableViolations = r.violations.filter((v) => v.code === 'forbidden_policy_profile_item_present');
    assert.equal(enforceableViolations.length, 1, 'a real forbidden-direction leak must still be blocked');
  });
});

describe('checkImpossibleEvidenceState — required direction, check #3 (Stage 2, shadow-only, added 2026-07-28)', () => {
  test('required policy + profile item present -> ok (the expected case, not a violation)', () => {
    const r = checkImpossibleEvidenceState(packWith([profileItem()]), 'required');
    assert.equal(r.ok, true);
  });

  test('RC-8 exact shape: required policy + zero profile-family evidence items -> violation', () => {
    // Reproduces RC-8's failure mode: capability IS granted (required
    // policy), but the legacy selector found nothing for this question (the
    // over-broad "about" qualifier bug made this happen 100% of the time
    // before RC-8's fix; a genuine no-match can also produce this shape).
    // Empirically confirmed against the real compiled ProfileEvidenceService
    // (2026-07-28): in this exact scenario, coverage.sourceOwnerSatisfied is
    // `true` (vacuous truth from `.every()` over an empty items array) even
    // though answerPolicy is 'refuse_insufficient_evidence' — so the design
    // doc's literal check #3 condition ("...AND coverage.sourceOwnerSatisfied
    // === false") would NOT have caught this. This test pins the actual
    // implementation (zero profile-family evidence items, independent of
    // the misleading coverage field) against that exact empty-pack shape.
    const emptyRequiredPack = packWith([], 'candidate_experience');
    const r = checkImpossibleEvidenceState(emptyRequiredPack, 'required');
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].code, 'required_policy_zero_evidence');
    assert.equal(r.violations[0].evidenceId, undefined, 'a pack-level violation has no single associated evidenceId');
  });

  test('required policy + a referent_only (not evidence-authority) item only -> violation (referent_only is not admitted as fact, so this still counts as zero evidence)', () => {
    const r = checkImpossibleEvidenceState(
      packWith([profileItem({ authority: 'referent_only' })], 'candidate_experience'),
      'required',
    );
    assert.equal(r.ok, false);
    assert.equal(r.violations[0].code, 'required_policy_zero_evidence');
  });

  test('Stage 1 enforcement filter (forbidden_policy_profile_item_present only) does NOT enforce this violation — required-direction enforcement stays shadow-only per the design doc\'s asymmetric staging', () => {
    const r = checkImpossibleEvidenceState(packWith([], 'candidate_experience'), 'required');
    const enforceableViolations = r.violations.filter((v) => v.code === 'forbidden_policy_profile_item_present');
    assert.equal(enforceableViolations.length, 0);
  });
});
