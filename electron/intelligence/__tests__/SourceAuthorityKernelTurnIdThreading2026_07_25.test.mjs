// Phase 6 Slice 1 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 1 — Stable turn and stream lifecycle"): pre-required test #2 —
// "asserting SourceAuthorityKernel.build's turnId and the CanonicalTurn's
// turnId (Slice 3) are the same value for the same turn." CanonicalTurn does
// not exist yet (Slice 3), so this is stubbed against a manually-constructed
// TurnIdentity, as the plan directs — but written to fail LOUDLY the moment a
// future kernel change stops honoring a caller-supplied turnId (e.g. if
// Slice 3 wires CanonicalTurn.turnId into the kernel and the kernel silently
// keeps minting its own instead of consuming it), not to pass vacuously
// against a self-constructed fixture.
//
// Concretely: this asserts the REAL, currently-shipped behavior — that
// kernel.build({ ..., turnId }) returns a contract whose `.turnId` is
// IDENTICAL to the caller-supplied value, not a freshly-minted one — via
// both the low-level SourceAuthorityKernel.build and the
// buildTurnContractForSurface adapter every real call site actually uses.
// That is exactly the invariant Slice 3 must preserve when CanonicalTurn
// starts supplying the value instead of a hand-built TurnIdentity.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/SourceAuthorityKernelTurnIdThreading2026_07_25.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
const { mintTurnId } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/turnIdentity.js'));

const kernel = new co.SourceAuthorityKernel();

function baseInput(overrides = {}) {
  return {
    surface: 'manual_chat',
    question: 'What are the four main phases of the project?',
    activeModeId: 'mode-1',
    activeModeName: 'Seminar',
    sourceAuthority: 'reference_files_only',
    answerShape: 'list',
    voicePerspective: 'assistant_explanation',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: true,
    ...overrides,
  };
}

describe('SourceAuthorityKernel.build honors a caller-supplied turnId (Slice 1 pre-required test #2)', () => {
  test('a manually-constructed TurnIdentity.turnId is threaded through VERBATIM, not replaced by a freshly-minted one', () => {
    // A real mint (electron/llm/turnIdentity.ts), standing in for what
    // Slice 3's CanonicalTurn will eventually supply.
    const identity = { turnId: mintTurnId(), attemptId: 1 };
    const contract = kernel.build(baseInput({ turnId: identity.turnId }));
    assert.equal(contract.turnId, identity.turnId,
      'kernel.build must return the CALLER\'S turnId, not mint its own, once CanonicalTurn (Slice 3) starts supplying it');
  });

  test('omitting turnId preserves the existing mint-your-own behavior (every current call site until updated)', () => {
    const a = kernel.build(baseInput());
    const b = kernel.build(baseInput());
    assert.notEqual(a.turnId, b.turnId, 'with no turnId supplied, each call still mints its own — unchanged legacy behavior');
    assert.equal(typeof a.turnId, 'string');
    assert.ok(a.turnId.length > 0);
  });

  test('two DIFFERENT hand-built identities are never conflated — the kernel does not silently ignore turnId and reuse a cached value', () => {
    const first = kernel.build(baseInput({ turnId: mintTurnId() }));
    const second = kernel.build(baseInput({ turnId: mintTurnId() }));
    assert.notEqual(first.turnId, second.turnId,
      'if the kernel ever ignored the caller-supplied turnId and fell back to a fixed/cached value, this would wrongly pass — it must not');
  });

  test('buildTurnContractForSurface (the adapter every real IPC/engine call site uses) forwards turnId identically', () => {
    const identity = { turnId: mintTurnId(), attemptId: 7 };
    const contract = co.buildTurnContractForSurface({
      surface: 'manual_chat',
      question: 'What are the four main phases of the project?',
      activeModeId: 'mode-1',
      activeModeName: 'Seminar',
      sourceAuthority: 'reference_files_only',
      answerType: 'list',
      hasReferenceFiles: true,
      hasProfileFacts: true,
      hasLiveTranscript: true,
      turnId: identity.turnId,
    });
    assert.equal(contract.turnId, identity.turnId,
      'buildTurnContractForSurface must forward turnId to the kernel unchanged — this is the adapter Slice 3 will actually wire CanonicalTurn.turnId through');
  });
});

describe('the two named mint points (renderer submit for manual chat; WTA) actually pass turnId — not just capability that no caller uses', () => {
  const ipcSrc = readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const engineSrc = readFileSync(path.resolve(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

  test('ipcHandlers.ts mints myTurnId at renderer-submit time and passes it to the manual-chat buildTurnContractIfEnabled call', () => {
    assert.match(ipcSrc, /const myTurnId = mintTurnId\(\);/);
    const callStart = ipcSrc.indexOf('turnContract = buildTurnContractIfEnabled({');
    const callEnd = ipcSrc.indexOf('});', callStart);
    assert.ok(callStart >= 0, 'expected the manual-chat buildTurnContractIfEnabled call');
    const call = ipcSrc.slice(callStart, callEnd);
    assert.match(call, /turnId: myTurnId,/);
  });

  test('IntelligenceEngine.ts mints _wtaTurnId at the classifyType/extractLatestQuestion entry and passes it to BOTH WTA buildTurnContractIfEnabled calls', () => {
    assert.match(engineSrc, /const _wtaTurnId = mintTurnId\(\);/);
    const matches = engineSrc.match(/turnId: _wtaTurnId,/g) || [];
    assert.equal(matches.length, 2, 'expected exactly 2 WTA buildTurnContractIfEnabled calls to receive turnId: _wtaTurnId');
  });
});
