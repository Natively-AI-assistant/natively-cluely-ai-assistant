// electron/intelligence/__tests__/UnknownOwnerGrantsJdEvidence2026_07_26.test.mjs
//
// Bug fix (2026-07-26, live-testing session): SourceAuthorityKernel.build's
// `sourceOwner === 'unknown'` capability branch (issueLegacyCapabilities /
// the "general mode, unambiguous question" path) granted `profile_resume`/
// `profile_project` when `hasProfileFacts` was true, but NEVER granted
// `profile_jd` under any condition — because `BuildTurnContractInput` had
// no `hasJobDescription` field at all. `hasJobDescription` WAS already
// computed at the ipcHandlers.ts manual-chat call site (used for
// `resolveTurnSourceDecision`/`resolveCanonicalTurn`) but never threaded
// into `buildTurnContractIfEnabled`.
//
// Live-reproduced: a custom mode with `sourceAuthority: 'ask_if_ambiguous'`
// (its `defaultOwner` is 'mixed'/'clarify', not 'reference_files'/
// 'profile'/'transcript') asked "What's the compensation range for this
// role?" — `AnswerPlanner` correctly classified this `jd_fact_answer`
// (requires the `jd` layer per `requiredLayersFor`), but the resolved
// `sourceOwner` was `unknown` (the question doesn't match
// AMBIGUOUS_SOURCE_TERM_RE, so resolveSourceOwner's clarify branch never
// fires) — and `unknown`'s capability grants had NO path to `profile_jd`
// even though a real JD was loaded. The model then answered fluently
// from zero evidence (`evidenceCoverage.confidence: 0`,
// `selectedEvidenceCount: 0`) instead of grounding in the JD's real
// compensation figures — the model effectively fabricated a candidate-fit
// narrative in place of the JD fact it was asked for.
//
// This test proves the fix: `unknown` now grants `profile_jd` (as
// `evidence`, tagged for role-requirement framing same as every other
// JD grant in this file) whenever `hasJobDescription` is true — mirroring
// exactly how `hasProfileFacts` already grants `profile_resume`/
// `profile_project` in the same branch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();

function build(overrides = {}) {
  return kernel.build({
    surface: 'manual_chat',
    question: "What's the compensation range for this role?",
    activeModeId: 'mode-1',
    activeModeName: 'Custom Mixed Mode',
    sourceAuthority: 'ask_if_ambiguous',
    answerShape: 'general',
    voicePerspective: 'assistant_explanation',
    enforcement: 'observe',
    hasReferenceFiles: false,
    hasProfileFacts: true,
    hasLiveTranscript: false,
    hasJobDescription: true,
    ...overrides,
  });
}

const kindsOf = (contract) => contract.allowedSources.map((c) => c.sourceKind);
const authorityOf = (contract, kind) =>
  contract.allowedSources.find((c) => c.sourceKind === kind)?.authority ?? 'absent';

describe('unknown owner (ask_if_ambiguous/general_mixed, no matching clarify term) grants profile_jd when a JD is loaded', () => {
  test('the exact live-repro case: a JD-fact question with no ambiguous-term match resolves to unknown owner AND grants profile_jd as evidence', () => {
    const c = build();
    assert.equal(c.sourceOwner, 'unknown', 'precondition: this question must NOT trip the clarify path (no AMBIGUOUS_SOURCE_TERM_RE match)');
    const kinds = kindsOf(c);
    assert.ok(kinds.includes('profile_jd'), 'profile_jd must be granted when hasJobDescription=true, even under unknown owner');
    assert.equal(authorityOf(c, 'profile_jd'), 'evidence');
  });

  test('profile_jd is NOT granted when hasJobDescription is false (no regression — must not grant it unconditionally)', () => {
    const c = build({ hasJobDescription: false });
    assert.equal(c.sourceOwner, 'unknown');
    assert.ok(!kindsOf(c).includes('profile_jd'), 'profile_jd must remain absent with no JD loaded, exactly like the pre-fix behavior');
  });

  test('profile_resume/profile_project grants are unaffected (existing hasProfileFacts behavior preserved)', () => {
    const c = build();
    const kinds = kindsOf(c);
    assert.ok(kinds.includes('profile_resume'));
    assert.ok(kinds.includes('profile_project'));
    assert.equal(authorityOf(c, 'profile_resume'), 'evidence');
  });

  test('general_mixed authority gets the same fix (not just ask_if_ambiguous)', () => {
    const c = build({ sourceAuthority: 'general_mixed' });
    assert.equal(c.sourceOwner, 'unknown');
    assert.ok(kindsOf(c).includes('profile_jd'));
  });

  test('a mode with NO profile facts and NO JD still grants nothing profile-shaped (no regression on the fully-empty case)', () => {
    const c = build({ hasProfileFacts: false, hasJobDescription: false });
    const kinds = kindsOf(c);
    for (const k of ['profile_resume', 'profile_project', 'profile_jd', 'profile_persona']) {
      assert.ok(!kinds.includes(k), `${k} must be absent with no profile/JD facts loaded`);
    }
  });
});
