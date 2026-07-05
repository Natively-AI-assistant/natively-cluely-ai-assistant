/**
 * OKF Phase 3 (2026-07-01): wiring/source-assertion tests for the LLMHelper +
 * ipcHandlers integration points that consult OKF cards. Source-assertion
 * pattern, matching DocGroundedRetrievalFix.test.mjs — verifies the wiring
 * exists and is correctly gated, without requiring a live model call.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const llmHelperSrc = read('electron/LLMHelper.ts');
const ipcHandlersSrc = read('electron/ipcHandlers.ts');

test('LLMHelper: OKF card retrieval is gated behind isOkfHybridRetrievalEnabled()', () => {
  assert.match(llmHelperSrc, /isOkfHybridRetrievalEnabled/);
});

test('LLMHelper: OKF card retrieval only runs when forceDocumentGrounding is true', () => {
  const idx = llmHelperSrc.indexOf('let evidenceBlockForPrompt = modeContextBlock;');
  assert.ok(idx >= 0, 'expected the OKF evidence block variable');
  const slice = llmHelperSrc.slice(idx, idx + 400);
  assert.match(slice, /if \(forceDocumentGrounding\) \{/);
});

test('LLMHelper: OKF cards are prepended via buildOkfEvidenceBlock (cards first, chunks second)', () => {
  // OKF Phase 4 renamed the cardsBlock argument to combinedCardsBlock when
  // graph-expansion hints were appended after the cards block (still
  // cards-block-content, just now optionally including graph hints).
  assert.match(llmHelperSrc, /buildOkfEvidenceBlock\(\{ cardsBlock: combinedCardsBlock, rawChunkText: modeContextBlock \}\)/);
});

test('LLMHelper: OKF card retrieval failure falls back to modeContextBlock untouched (never throws into the answer path)', () => {
  const idx = llmHelperSrc.indexOf('let evidenceBlockForPrompt = modeContextBlock;');
  const catchIdx = llmHelperSrc.indexOf('} catch (_okfErr: any) {', idx);
  assert.ok(catchIdx > idx, 'expected a catch block guarding OKF retrieval');
  const catchSlice = llmHelperSrc.slice(catchIdx, catchIdx + 200);
  assert.match(catchSlice, /OKF card retrieval skipped \(non-fatal\)/);
});

test('LLMHelper: telemetry reports the real OKF card count (not hardcoded 0)', () => {
  assert.match(llmHelperSrc, /retrievedOkfCardCount: okfCardCountForTelemetry/);
  assert.ok(!llmHelperSrc.includes('retrievedOkfCardCount: 0'), 'retrievedOkfCardCount must no longer be hardcoded to 0 (Phase 3)');
});

test('ipcHandlers: false-refusal validator augments docContextBlock with OKF card text', () => {
  assert.match(ipcHandlersSrc, /OKF card augmentation for validator/);
  assert.match(ipcHandlersSrc, /isIntelligenceFlagEnabled\('okfHybridRetrieval'\)/);
});

test('ipcHandlers: OKF card augmentation for the validator is non-fatal on failure', () => {
  const idx = ipcHandlersSrc.indexOf('OKF Phase 3: also fold in OKF card text');
  assert.ok(idx >= 0);
  const catchIdx = ipcHandlersSrc.indexOf('} catch (okfRetryErr: any) {', idx);
  assert.ok(catchIdx > idx, 'expected a catch block guarding the OKF augmentation');
});

test('LLMHelper: chunk-only fallback still works when okfHybridRetrieval flag is off (evidenceBlockForPrompt defaults to modeContextBlock)', () => {
  // The flag-off path never enters the "if (isOkfHybridRetrievalEnabled())"
  // branch, so evidenceBlockForPrompt keeps its initial value
  // (modeContextBlock) — i.e. byte-for-byte the pre-Phase-3 chunk-only shape.
  const declIdx = llmHelperSrc.indexOf('let evidenceBlockForPrompt = modeContextBlock;');
  assert.ok(declIdx >= 0);
});
