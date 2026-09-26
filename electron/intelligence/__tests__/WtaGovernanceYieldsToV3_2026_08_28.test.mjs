// T3-minimal — WTA's copy of the Context OS governance gate was missing
// `!v3OwnedTurn`.
//
// THE BUG, as reported: mocking an interview, the interviewer's spoken
// "introduce yourself, what are your AI projects" came back as "I don't have
// enough verified context" on live audio, while the SAME question typed into
// manual chat answered normally.
//
// THE MECHANISM: in a mode holding reference files, every WTA turn is governed.
// EvidenceResolver searches reference files ONLY (EvidenceResolver.ts:326), so
// a question about the user's own profile resolves an empty pack ->
// `refuse_insufficient_evidence`. The governed block blanks
// `typedCandidateProfile` (removing the resume that could have answered) and
// then hard-returns a canned refusal — with no model call, and with V3's
// composed prompt, not read until ~200 lines later, discarded unread.
//
// Manual chat was never exposed: it passes `{ v3Owned: true }`
// (ipcHandlers.ts:1473), and `LLMHelper.ts:6656` has carried `!v3OwnedTurn`
// since it was written. WhatToAnswerLLM's two in-file copies of that condition
// never had it. A duplicated-logic drift, not a design decision — which is why
// the fix extracts the condition into ONE function instead of writing it a
// third time.
//
// WHAT THIS SUITE PROVES
//   1. a V3-composed turn no longer lets the legacy pack govern (the fix);
//   2. a LEGACY, non-V3 WTA turn KEEPS governance in both positions — the
//      explicit verification the fix plan requires, and the direction in which
//      an over-broad guard would silently disable a real protection;
//   3. the render gate is guarded independently of the resolver gate, which is
//      the half that actually refuses;
//   4. the kill switch restores the pre-fix behaviour exactly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

const { wtaGovernanceDecision } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/wtaGovernanceGate.js'));
const { isIntelligenceFlagEnabled } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'));

/** A governed, document-grounded WTA turn — the shape the reported bug had. */
const governedDocGrounded = (over = {}) => ({
  govern: true,
  v3PromptPresent: false,
  forceDocumentGrounding: true,
  evidencePackFlagEnabled: true,
  yieldToV3FlagEnabled: true,
  ...over,
});

describe('T3-minimal — a V3-composed turn is not also governed by the legacy pack', () => {
  test('V3 present => neither gate opens, and the yield is reported', () => {
    const d = wtaGovernanceDecision(governedDocGrounded({ v3PromptPresent: true }));
    assert.equal(d.resolvePack, false, 'the resolver gate must not open on a V3 turn');
    assert.equal(d.renderPack, false, 'the render gate — the one that refuses — must not open either');
    assert.equal(d.yieldedToV3, true, 'the yield must be observable so it can be logged');
  });

  // The render gate is the one that hard-returns. Guarding only the resolver
  // gate leaves the refusal reachable, because `renderPack` does not test
  // `forceDocumentGrounding` and its pack falls back to the caller-supplied
  // `_cog.evidencePack`.
  test('V3 present with NO doc-grounding => the render gate is still closed', () => {
    const d = wtaGovernanceDecision(governedDocGrounded({ v3PromptPresent: true, forceDocumentGrounding: false }));
    assert.equal(d.renderPack, false);
    assert.equal(d.yieldedToV3, true);
  });
});

describe('T3-minimal — LEGACY (non-V3) WTA turns keep governance', () => {
  // This is the direction the fix must NOT break: the fix plan calls for
  // explicit verification that legacy WTA turns, which have no V3 prompt and
  // still need the pack, are unaffected.
  test('no V3 prompt => both gates open exactly as before', () => {
    const d = wtaGovernanceDecision(governedDocGrounded());
    assert.equal(d.resolvePack, true, 'a legacy doc-grounded turn must still resolve its pack');
    assert.equal(d.renderPack, true, 'a legacy turn must still be governed by that pack');
    assert.equal(d.yieldedToV3, false);
  });

  test('no V3 prompt, no doc-grounding => the caller-resolved pack still governs', () => {
    // The multi-family coordinator pre-resolves a pack for non-doc-grounded
    // turns. `renderPack` is deliberately not gated on forceDocumentGrounding,
    // and that asymmetry predates this repair.
    const d = wtaGovernanceDecision(governedDocGrounded({ forceDocumentGrounding: false }));
    assert.equal(d.resolvePack, false, 'nothing to resolve — the caller already did');
    assert.equal(d.renderPack, true, 'but the caller-resolved pack must still govern');
  });

  test('govern=false => nothing opens, V3 or not', () => {
    for (const v3PromptPresent of [true, false]) {
      const d = wtaGovernanceDecision(governedDocGrounded({ govern: false, v3PromptPresent }));
      assert.deepEqual(d, { resolvePack: false, renderPack: false, yieldedToV3: false });
    }
  });

  test('the Context OS pack flag still switches everything off', () => {
    const d = wtaGovernanceDecision(governedDocGrounded({ evidencePackFlagEnabled: false }));
    assert.deepEqual(d, { resolvePack: false, renderPack: false, yieldedToV3: false });
  });
});

describe('T3-minimal — the kill switch restores the pre-fix behaviour exactly', () => {
  test('yieldToV3 off => a V3 turn is governed again, as it was before the fix', () => {
    const d = wtaGovernanceDecision(governedDocGrounded({ v3PromptPresent: true, yieldToV3FlagEnabled: false }));
    assert.equal(d.resolvePack, true);
    assert.equal(d.renderPack, true);
    assert.equal(d.yieldedToV3, false);
  });

  test('flag ON and flag OFF differ ONLY when a V3 prompt is present', () => {
    for (const forceDocumentGrounding of [true, false]) {
      const on = wtaGovernanceDecision(governedDocGrounded({ forceDocumentGrounding, yieldToV3FlagEnabled: true }));
      const off = wtaGovernanceDecision(governedDocGrounded({ forceDocumentGrounding, yieldToV3FlagEnabled: false }));
      assert.deepEqual(on, off,
        `without a V3 prompt the flag must change nothing (forceDocumentGrounding=${forceDocumentGrounding})`);
    }
  });
});

describe('T3-minimal — the flag default is environment-invariant', () => {
  // The invariant, not the literal: 20 of the 62 flags in this registry resolve
  // differently in dev/test via isInternalDevTestContext, and that split is how
  // composePrompt was built, tested, and never executed for a user. A fix for a
  // production failure must not be one of them.
  test('NODE_ENV does not change wtaGovernanceYieldsToV3', () => {
    const original = process.env.NODE_ENV;
    const seen = new Set();
    try {
      for (const env of ['production', 'development', 'test', undefined]) {
        if (env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = env;
        seen.add(isIntelligenceFlagEnabled('wtaGovernanceYieldsToV3'));
      }
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
    assert.equal(seen.size, 1, `flag resolved differently across environments: ${[...seen]}`);
  });

  test('the env kill switch works in both directions', () => {
    const KEY = 'NATIVELY_WTA_GOVERNANCE_YIELDS_TO_V3';
    const original = process.env[KEY];
    try {
      process.env[KEY] = '0';
      assert.equal(isIntelligenceFlagEnabled('wtaGovernanceYieldsToV3'), false);
      process.env[KEY] = '1';
      assert.equal(isIntelligenceFlagEnabled('wtaGovernanceYieldsToV3'), true);
    } finally {
      if (original === undefined) delete process.env[KEY];
      else process.env[KEY] = original;
    }
  });
});
