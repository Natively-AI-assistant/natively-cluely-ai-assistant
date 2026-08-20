// electron/services/__tests__/ScreenshotOutranksTextDecline2026_08_19.test.mjs
//
// User directive 2026-08-19: "no context of screenshot is dropped if the
// contexts disagree." A screenshot is the user DELIBERATELY handing the turn
// its evidence; every canned decline in the Context OS govern path is a
// verdict about the TEXT universe only. Audit found four decline sites that
// could discard user-attached pixels; manual chat's clarify short-circuit was
// the only one already image-gated (`!imagePaths?.length`, ipcHandlers).
//
// The rule is now the pure predicate declineYieldsToAttachedImages
// (refusalPolicy.ts), wired at:
//   1. WhatToAnswerLLM govern block   — refuse/clarify short-circuits
//   2. LLMHelper govern block         — refuse/clarify short-circuits
//   3. LLMHelper final-prompt boundary — fail-closed refusal
//   4. IntelligenceEngine post-stream doc-grounded validator — answer swap
//
// Source isolation is NOT weakened: exempted turns skip pack RENDERING too, so
// no forbidden text source is added back, and the profile stays suppressed on
// governed WTA turns (candidateProfile blanked upstream of the exemption).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { declineYieldsToAttachedImages, packGovernsGeneration, boundaryDeclineYieldsToAttachedImages } = await import(
  pathToFileURL(path.join(base, 'intelligence/context-os/refusalPolicy.js')).href
);

describe('declineYieldsToAttachedImages (pure rule)', () => {
  test('refuse + screenshot → yields (answer from pixels, no canned refusal)', () => {
    assert.equal(
      declineYieldsToAttachedImages({ answerPolicy: 'refuse_insufficient_evidence', hasAttachedImages: true }),
      true,
    );
  });

  test('clarify + screenshot → yields (matches manual chat’s image gate)', () => {
    assert.equal(
      declineYieldsToAttachedImages({ answerPolicy: 'ask_clarification', hasAttachedImages: true }),
      true,
    );
  });

  test('no screenshot → never yields (bounded-universe refusals stay honest)', () => {
    for (const answerPolicy of ['refuse_insufficient_evidence', 'ask_clarification']) {
      assert.equal(declineYieldsToAttachedImages({ answerPolicy, hasAttachedImages: false }), false, answerPolicy);
    }
  });

  test('answer policies are untouched — no power transfer on agreeing turns', () => {
    for (const answerPolicy of ['answer', 'answer_with_uncertainty']) {
      assert.equal(declineYieldsToAttachedImages({ answerPolicy, hasAttachedImages: true }), false, answerPolicy);
    }
  });

  test('composes with packGovernsGeneration, it does not replace it: an ungoverned refusal never reaches a decline site', () => {
    // profile_only refusal → govern:false (2026-08-11 line) → legacy path;
    // the new predicate only matters where govern:true survives (bounded
    // universes with files). Assert the layering assumption holds.
    assert.equal(
      packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: 'profile_only' }),
      false,
    );
    assert.equal(
      packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: 'reference_files_only', hasReferenceFiles: true }),
      true,
    );
  });
});

// Wiring drift-guards: structural facts only (identifiers/gates), per repo
// convention (ContextOsRefusalGoverns2026_08_11 pattern).
describe('decline sites are image-exempted', () => {
  const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

  test('WhatToAnswerLLM govern block gates its short-circuits on the predicate', () => {
    const src = read('electron/llm/WhatToAnswerLLM.ts');
    assert.match(src, /declineYieldsToAttachedImages\(\{\s*answerPolicy: pack\.answerPolicy,\s*hasAttachedImages,/);
  });

  test('LLMHelper govern block gates its short-circuits on the predicate', () => {
    const src = read('electron/LLMHelper.ts');
    assert.match(src, /_declineYieldsLLM\(\{ answerPolicy: pack\.answerPolicy, hasAttachedImages: Boolean\(imagePaths\?\.length\) \}\)/);
  });

  test('LLMHelper final-prompt boundary dispatches instead of refusing when images attached', () => {
    const src = read('electron/LLMHelper.ts');
    // Pin NARROWED 2026-08-19 (code review): the boundary yield is keyed on the
    // validator's REASON, not on `!ok` alone. Only the two decline reasons
    // yield to pixels; a structural failure or forbidden_evidence_rendered
    // must still fail closed, or a source-isolation leak would be dispatched
    // to every cloud provider unvalidated whenever a screenshot is attached.
    assert.match(src, /_boundaryYields\(\{\s*reason: finalPromptValidation\.reason,/);
    assert.doesNotMatch(
      src,
      /if \(!finalPromptValidation\.ok && imagePaths\?\.length\) \{/,
      'the blanket !ok bypass must not return — it exempted forbidden-evidence failures',
    );
  });

  test('boundaryDeclineYieldsToAttachedImages yields ONLY for decline reasons', () => {
    for (const reason of ['answer_policy_ask_clarification', 'answer_policy_refuse_insufficient_evidence']) {
      assert.equal(boundaryDeclineYieldsToAttachedImages({ reason, hasAttachedImages: true }), true, reason);
      assert.equal(boundaryDeclineYieldsToAttachedImages({ reason, hasAttachedImages: false }), false, reason);
    }
    // Source isolation and structural integrity NEVER yield, pixels or not.
    for (const reason of [
      'forbidden_evidence_rendered:profile_resume',
      'rendered_manifest_invalid',
      'serialized_evidence_marker_missing',
      'missing_required_evidence_family:reference_files',
    ]) {
      assert.equal(boundaryDeclineYieldsToAttachedImages({ reason, hasAttachedImages: true }), false, reason);
    }
  });

  test('post-stream doc-grounded validator skips image turns (answer-swap site)', () => {
    const src = read('electron/IntelligenceEngine.ts');
    // The validator gate: hasReferenceFiles && doc-shaped && image-exempt.
    assert.match(
      src,
      /hasReferenceFiles\)\s*&& isDocGroundedAnswerType\(answerPlan\.answerType\)[\s\S]{0,700}&& !\(imagePaths\?\.length\)/,
    );
  });

  test('manual chat clarify short-circuit keeps its original image gate', () => {
    const src = read('electron/ipcHandlers.ts');
    const idx = src.indexOf("turnContract.sourceOwner === 'clarify'");
    assert.ok(idx > 0);
    assert.match(src.slice(idx, idx + 400), /!imagePaths\?\.length/);
  });
});
