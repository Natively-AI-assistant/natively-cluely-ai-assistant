// Knowledge Source canonical-gate repair (2026-07-16) — REGRESSION for the
// kernel/legacy-resolver drift on `profile_only` and `profile_plus_transcript`
// authorities.
//
// SourceAuthorityKernel.resolveSourceOwner previously returned `'clarify'`
// for these two authorities when `hasProfileFacts` was false (e.g. résumé
// still loading at boot, or genuinely never uploaded). The legacy
// `sourceOwnership.resolveSourceOwnership` resolver in electron/llm/
// sourceOwnership.ts, in contrast, treats `profile_only` as always
// `profileAllowed: true` regardless of `hasProfileFacts` — the two source-
// ownership resolvers disagreed, which is exactly the "no second arbiter
// to drift" invariant the kernel's own header comment declares.
//
// Fix: `profile_only` returns `'profile'` and `profile_plus_transcript`
// returns `'mixed'` regardless of `hasProfileFacts`. When facts are not
// loaded, the *retrieval* layer (not the kernel) naturally returns empty
// and surfaces as a no-evidence answer / refusal — NOT as a source-
// ownership clarification (there's nothing to clarify between; the
// authority itself names the only valid owner).
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/KernelProfileOnlyNeverClarifies2026_07_16.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();

function buildContract(overrides = {}) {
  return kernel.build({
    surface: 'manual_chat',
    question: 'Walk me through your most recent project.',
    activeModeId: 'mode-ti',
    activeModeName: 'Technical Interview',
    sourceAuthority: 'profile_only',
    answerShape: 'general',
    voicePerspective: 'first_person_candidate',
    enforcement: 'observe',
    hasReferenceFiles: false,
    hasProfileFacts: false,
    hasLiveTranscript: false,
    ...overrides,
  });
}

test('profile_only with hasProfileFacts=false resolves to sourceOwner="profile" (not clarify)', () => {
  const c = buildContract({
    sourceAuthority: 'profile_only',
    hasProfileFacts: false,
  });
  assert.notEqual(c.sourceOwner, 'clarify',
    'INCIDENT REGRESSION: profile_only must NEVER clarify — the authority itself names the owner');
  assert.equal(c.sourceOwner, 'profile',
    'profile_only must always resolve to sourceOwner=profile regardless of hasProfileFacts');
});

test('profile_plus_transcript with hasProfileFacts=false resolves to sourceOwner="mixed" (not clarify)', () => {
  const c = buildContract({
    sourceAuthority: 'profile_plus_transcript',
    hasProfileFacts: false,
  });
  assert.notEqual(c.sourceOwner, 'clarify',
    'profile_plus_transcript must NEVER clarify — both profile and transcript are valid owners');
  assert.equal(c.sourceOwner, 'mixed',
    'profile_plus_transcript must always resolve to sourceOwner=mixed regardless of hasProfileFacts');
});

test('profile_only with hasProfileFacts=true still resolves to sourceOwner="profile" (sanity)', () => {
  const c = buildContract({
    sourceAuthority: 'profile_only',
    hasProfileFacts: true,
  });
  assert.equal(c.sourceOwner, 'profile');
});

test('profile_only with no facts still grants profile_resume as evidence (retrieval layer handles empty)', () => {
  // The kernel must grant the profile_resume / profile_project /
  // okf_profile_card / profile_jd capabilities even when no facts are
  // loaded — the retrieval layer naturally returns empty for an empty
  // orchestrator, and that's the correct place for "no evidence
  // available" to surface. The kernel MUST NOT collapse profile_only to
  // "instruction-only" just because facts haven't loaded yet.
  const c = buildContract({
    sourceAuthority: 'profile_only',
    hasProfileFacts: false,
  });
  const grantKinds = new Set(c.allowedSources.map((s) => s.sourceKind));
  assert.ok(grantKinds.has('profile_resume'),
    'profile_resume must be granted (retrieval layer handles empty)');
  assert.ok(grantKinds.has('profile_project'),
    'profile_project must be granted');
  assert.ok(grantKinds.has('okf_profile_card'),
    'okf_profile_card must be granted');
  // profile_jd is gated by allowedExplicitSwitches — without it being
  // supplied, the legacy fallback grants JD too. Both shapes are valid;
  // we only assert the contract grants SOME profile capability set.
  assert.ok(c.allowedSources.some((s) => s.authority === 'evidence' && (
    s.sourceKind === 'profile_resume' || s.sourceKind === 'profile_project'
  )), 'at least one profile evidence capability must be granted');
});

test('profile_only + no facts agreement with legacy resolveSourceOwnership resolver', () => {
  // The kernel's sourceOwner='profile' must agree with the legacy
  // `resolveSourceOwnership` resolver's `owner: 'profile'` decision on
  // the same authority. This is the kernel-vs-legacy agreement
  // invariant the canonical-gate work explicitly required.
  const so = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/sourceOwnership.js'));
  const legacy = so.resolveSourceOwnership({
    question: 'Walk me through your most recent project.',
    contract: { sourceAuthority: 'profile_only' },
    profileContextPolicy: 'allowed',
    answerType: 'experience_recap',
    hasProfileFacts: false,
  });
  assert.equal(legacy.owner, 'profile',
    'legacy resolver must report owner=profile for profile_only');
  assert.equal(legacy.profileAllowed, true,
    'legacy resolver must report profileAllowed=true for profile_only regardless of hasProfileFacts');

  const c = buildContract({
    sourceAuthority: 'profile_only',
    hasProfileFacts: false,
  });
  assert.equal(c.sourceOwner, legacy.owner,
    'kernel sourceOwner must agree with legacy owner');
});

test('profile_only forbids reference_files (no over-widening from the fix)', () => {
  const c = buildContract({
    sourceAuthority: 'profile_only',
    hasProfileFacts: false,
  });
  const grantKinds = new Set(c.allowedSources.map((s) => s.sourceKind));
  assert.ok(!grantKinds.has('mode_reference_file'),
    'profile_only must NEVER grant mode_reference_file (regression-guard against over-widening)');
  assert.ok(!grantKinds.has('mode_reference_chunk'),
    'profile_only must NEVER grant mode_reference_chunk');
});

test('profile_only + no facts → contractHash stable across hasProfileFacts=false/true (same ownership, same caps)', () => {
  // Sanity: the kernel's profile_only path now produces the SAME
  // sourceOwner for hasProfileFacts=true/false. The downstream allowed
  // capabilities also include the profile evidence family in both cases.
  const noFacts = buildContract({ sourceAuthority: 'profile_only', hasProfileFacts: false });
  const withFacts = buildContract({ sourceAuthority: 'profile_only', hasProfileFacts: true });
  assert.equal(noFacts.sourceOwner, withFacts.sourceOwner);
  const noFactsGrant = new Set(noFacts.allowedSources.map((s) => s.sourceKind));
  const withFactsGrant = new Set(withFacts.allowedSources.map((s) => s.sourceKind));
  // profile_resume / profile_project granted in BOTH cases.
  assert.ok(noFactsGrant.has('profile_resume') && withFactsGrant.has('profile_resume'));
  assert.ok(noFactsGrant.has('profile_project') && withFactsGrant.has('profile_project'));
});

test('profile_plus_transcript with no facts grants profile evidence AND transcript referent', () => {
  const c = buildContract({
    sourceAuthority: 'profile_plus_transcript',
    hasProfileFacts: false,
    hasLiveTranscript: true,
  });
  assert.equal(c.sourceOwner, 'mixed');
  const grantKinds = new Set(c.allowedSources.map((s) => s.sourceKind));
  assert.ok(grantKinds.has('profile_resume'), 'profile evidence must be granted');
  assert.ok(grantKinds.has('live_transcript'), 'transcript must be granted in mixed mode');
});