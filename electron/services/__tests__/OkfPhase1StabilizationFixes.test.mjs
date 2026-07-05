/**
 * OKF Phase 1 (2026-07-01): regression tests for the 3 remaining stabilization
 * fixes not covered by the pre-existing DocGroundedRetrievalFix.test.mjs suite:
 *
 *  F4. Hybrid retriever per-section dedup (was per-file — lost multi-section
 *      answers on long PDFs).
 *  F6. Positive Hindsight/profile isolation gate when forceDocumentGrounding
 *      is true and retrieval misses (was falling through to combinedContext,
 *      which can carry Hindsight facts under a header implying document truth).
 *  F7. priorContext threaded into buildDocumentGroundedUserContent for
 *      follow-up pronoun resolution.
 *
 * Source-assertion pattern, matching DocGroundedRetrievalFix.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const hybridSrc = read('electron/services/modes/ModeHybridRetriever.ts');
const llmHelperSrc = read('electron/LLMHelper.ts');
const ipcHandlersSrc = read('electron/ipcHandlers.ts');

// ---------------------------------------------------------------------------
// F4: per-section dedup
// ---------------------------------------------------------------------------
test('ModeHybridRetriever: deduplicateChunks accepts a forceDocumentGrounding param', () => {
  assert.match(hybridSrc, /private deduplicateChunks\(candidates: ChunkCandidate\[\], byRerank: boolean = false, forceDocumentGrounding: boolean = false\)/);
});

test('ModeHybridRetriever: defines dedupeGroupKey deriving a section-scoped key from the [Section N.N] chunk prefix', () => {
  assert.match(hybridSrc, /private dedupeGroupKey\(candidate: ChunkCandidate\): string/);
  assert.match(hybridSrc, /\^\\\[Section \(\[\\d\.\]\+\)/);
});

test('ModeHybridRetriever: dedup key falls back to per-chunk (not per-file) when no section prefix exists', () => {
  assert.match(hybridSrc, /`\$\{candidate\.sourceId\}#chunk\$\{candidate\.chunkIndex\}`/);
});

test('ModeHybridRetriever: non-doc-grounded dedup still keys by sourceId only (unchanged default-mode behavior)', () => {
  assert.match(hybridSrc, /const key = forceDocumentGrounding \? this\.dedupeGroupKey\(candidate\) : candidate\.sourceId;/);
});

test('ModeHybridRetriever: the retrieve() call site passes forceDocumentGrounding into deduplicateChunks', () => {
  assert.match(hybridSrc, /this\.deduplicateChunks\(candidates, reranked, forceDocumentGrounding\)/);
});

// ---------------------------------------------------------------------------
// F7: priorContext threading
// ---------------------------------------------------------------------------
test('LLMHelper: captures callerSuppliedContextForPriorResolution before mode-injection mutates context', () => {
  assert.match(llmHelperSrc, /const callerSuppliedContextForPriorResolution = context;/);
});

test('LLMHelper: passes priorContext into buildDocumentGroundedUserContent on the retrieval-hit path', () => {
  // OKF Phase 3 renamed the retrievedBlock source from modeContextBlock to
  // evidenceBlockForPrompt (which defaults to modeContextBlock when OKF cards
  // are off/unavailable) — same branch, updated variable name.
  const idx = llmHelperSrc.indexOf('if (forceDocumentGrounding && evidenceBlockForPrompt)');
  assert.ok(idx >= 0, 'expected to find the retrieval-hit branch');
  const slice = llmHelperSrc.slice(idx, idx + 700);
  assert.match(slice, /priorContext: callerSuppliedContextForPriorResolution/);
});

// ---------------------------------------------------------------------------
// F6: positive Hindsight/profile isolation gate
// ---------------------------------------------------------------------------
test('LLMHelper: retrieval-miss path checks isDocGroundedStrictIsolationEnabled before falling through to combinedContext', () => {
  assert.match(llmHelperSrc, /isDocGroundedStrictIsolationEnabled/);
  const idx = llmHelperSrc.indexOf('} else if (forceDocumentGrounding) {');
  assert.ok(idx >= 0, 'expected to find the retrieval-miss branch (forceDocumentGrounding && !modeContextBlock)');
});

test('LLMHelper: retrieval-miss path under strict isolation does NOT ship combinedContext as document evidence', () => {
  const idx = llmHelperSrc.indexOf('} else if (forceDocumentGrounding) {');
  const endIdx = llmHelperSrc.indexOf('} else {', idx);
  const slice = llmHelperSrc.slice(idx, endIdx);
  // Under the strict-isolation branch, userContent must come from
  // buildDocumentGroundedUserContent with an EMPTY retrievedBlock, never from
  // `CONTEXT:\n${combinedContext}` directly inside the isDocGroundedStrictIsolationEnabled() branch.
  const strictBranchIdx = slice.indexOf('if (isDocGroundedStrictIsolationEnabled())');
  assert.ok(strictBranchIdx >= 0, 'expected to find the strict-isolation branch');
  const elseBranchIdx = slice.indexOf('} else {', strictBranchIdx);
  const strictBranch = slice.slice(strictBranchIdx, elseBranchIdx);
  assert.match(strictBranch, /retrievedBlock: ''/);
  assert.ok(!strictBranch.includes('CONTEXT:\\n${combinedContext}'), 'strict-isolation branch must not ship combinedContext as document evidence');
});

test('ipcHandlers: Hindsight live recall is gated off for document-grounded turns under docGroundedStrictIsolation', () => {
  assert.match(ipcHandlersSrc, /const _isDocGroundedTurn = manualActiveMode\?\.documentGroundedCustomModeActive === true;/);
  const idx = ipcHandlersSrc.indexOf('const _isDocGroundedTurn');
  const slice = ipcHandlersSrc.slice(idx, idx + 600);
  assert.match(slice, /!\(_isDocGroundedTurn && isIntelligenceFlagEnabled\('docGroundedStrictIsolation'\)\)/);
});

// ---------------------------------------------------------------------------
// Behavioral simulation of the dedup key logic
// ---------------------------------------------------------------------------
function simulateDedupeGroupKey(candidate) {
  const sectionMatch = candidate.text.match(/^\[Section ([\d.]+)/);
  return sectionMatch ? `${candidate.sourceId}#${sectionMatch[1]}` : `${candidate.sourceId}#chunk${candidate.chunkIndex}`;
}

test('simulation: two different sections of the same file produce two distinct dedup keys', () => {
  const a = { sourceId: 'file1', chunkIndex: 0, text: '[Section 2.1.2 | p13-14] OpenVLA-OFT ...' };
  const b = { sourceId: 'file1', chunkIndex: 5, text: '[Section 3.4 | p57-58] AutoGen ...' };
  assert.notEqual(simulateDedupeGroupKey(a), simulateDedupeGroupKey(b));
});

test('simulation: the same section from the same file (different chunk offsets) collapses to one dedup key', () => {
  const a = { sourceId: 'file1', chunkIndex: 0, text: '[Section 2.1.2 | p13-14] OpenVLA-OFT replaces autoregressive...' };
  const b = { sourceId: 'file1', chunkIndex: 1, text: '[Section 2.1.2 | p13-14] ...continued discussion of OpenVLA-OFT' };
  assert.equal(simulateDedupeGroupKey(a), simulateDedupeGroupKey(b));
});

test('simulation: chunks with no section prefix dedup per-chunk, not per-file', () => {
  const a = { sourceId: 'file1', chunkIndex: 0, text: 'flat prose chunk one' };
  const b = { sourceId: 'file1', chunkIndex: 1, text: 'flat prose chunk two' };
  assert.notEqual(simulateDedupeGroupKey(a), simulateDedupeGroupKey(b));
});
