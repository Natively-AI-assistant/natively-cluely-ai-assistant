// electron/llm/__tests__/DefaultDecisionUnknownOwnerGrantsEvidence2026_07_26.test.mjs
//
// Bug fix (2026-07-26, live-testing session): the REAL root cause of the
// live "wrong answers" bug. `defaultDecision()`'s fallback branch for
// general_mixed/ask_if_ambiguous authorities (no explicit switch selected)
// returned `owner: 'unknown'` with NO `allowed` array at all — `result()`
// defaults `allowedEvidenceKinds` to `[]` when `allowed` is omitted — no
// matter what `availability.hasProfileFacts`/`hasJobDescription` said.
//
// This is the decision `ipcHandlers.ts`'s manual-chat call site ALWAYS
// produces when a mode has a persisted sourceContract (`manualTurnSourceDecision`,
// built via `resolveTurnSourceDecision`), and `SourceAuthorityKernel.build`
// always prefers `issueDecisionCapabilities(decision)` over the legacy
// `issueCapabilities(sourceOwner)` path whenever a decision is supplied — so
// this exact function is what actually ran for the live bug (a custom mode
// with `ask_if_ambiguous` authority, asked a JD-fact question that didn't
// match AMBIGUOUS_SOURCE_TERM_RE): zero evidence was granted despite a real
// JD/résumé being loaded, and the model answered fluently from nothing.
//
// Fix mirrors the existing profile_only/profile_plus_transcript branch just
// above it in the same file: build an `allowed` list from `availability`
// instead of leaving it empty.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const { resolveTurnSourceDecision } = await import(
  pathToFileURL(path.join(distDir, 'llm/turnSourceDecision.js')).href
);

function mode(sourceAuthority) {
  return {
    defaultOwner: 'mixed',
    sourceAuthority,
    allowedExplicitSwitches: ['reference_files', 'profile', 'job_description', 'transcript'],
  };
}

describe('defaultDecision() unknown-owner fallback (general_mixed/ask_if_ambiguous, no explicit switch)', () => {
  test('the live-repro case: a JD-fact question resolves to unknown owner but still grants profile_jd + profile_resume', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('ask_if_ambiguous'),
      persistedSourceAuthority: 'ask_if_ambiguous',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.owner, 'unknown');
    assert.equal(decision.outcome, 'default');
    assert.ok(decision.allowedEvidenceKinds.includes('profile_jd'), 'profile_jd must be allowed when hasJobDescription=true, even under unknown owner');
    assert.ok(decision.allowedEvidenceKinds.includes('profile_resume'), 'profile_resume must be allowed when hasProfileFacts=true');
  });

  test('no JD loaded: profile_jd stays absent (no unconditional grant)', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('ask_if_ambiguous'),
      persistedSourceAuthority: 'ask_if_ambiguous',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: true,
        hasJobDescription: false,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.owner, 'unknown');
    assert.ok(!decision.allowedEvidenceKinds.includes('profile_jd'));
  });

  test('general_mixed authority gets the same fix (not just ask_if_ambiguous)', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('general_mixed'),
      persistedSourceAuthority: 'general_mixed',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.owner, 'unknown');
    assert.ok(decision.allowedEvidenceKinds.includes('profile_jd'));
  });

  test('nothing available: allowedEvidenceKinds stays empty (no regression on the fully-empty case)', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('ask_if_ambiguous'),
      persistedSourceAuthority: 'ask_if_ambiguous',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: false,
        hasJobDescription: false,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.equal(decision.owner, 'unknown');
    assert.deepEqual(decision.allowedEvidenceKinds, []);
  });

  test('required evidence kinds remain empty under unknown owner (allowed, not required — caller still decides weighting)', () => {
    const decision = resolveTurnSourceDecision({
      sourceContract: mode('ask_if_ambiguous'),
      persistedSourceAuthority: 'ask_if_ambiguous',
      explicitRequest: null,
      explicitRequests: [],
      availability: {
        hasReferenceFiles: false,
        hasProfileFacts: true,
        hasJobDescription: true,
        hasLiveTranscript: false,
        hasMeetingRag: false,
      },
    });
    assert.deepEqual(decision.requiredEvidenceKinds, []);
  });
});
