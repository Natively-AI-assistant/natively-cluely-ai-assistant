// Regression tests for retrieval consolidation (root-cause fix, 2026-07-23).
//
// Root cause: when a manual-chat turn was NOT governed by a typed EvidencePack
// (e.g. contextOsEvidencePackEnabled off, or a contract-build failure), the
// post-stream doc-grounded validator in ipcHandlers.ts independently RE-
// RETRIEVED the reference block with different query expansion
// (expandQueryWithHints) and a different budget than whatever the original
// generation call inside LLMHelper._streamChatInner had already retrieved —
// meaning the answer could be validated against evidence it was never
// actually grounded in (or vice versa), the exact defect class
// EvidenceResolver.ts's own header says it was built to eliminate, except the
// elimination was incomplete for non-typed-pack turns.
//
// The fix: LLMHelper._streamChatInner now writes the block it actually used
// (whatever branch produced it — typed pack, EvidenceResolver, hybrid rerank,
// or sync lexical) onto ContextOsGenerationContext.retrievedBlockRaw
// UNCONDITIONALLY, and ipcHandlers.ts prefers that captured block before ever
// falling back to an independent re-retrieval.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('ContextOsGenerationContext declares retrievedBlockRaw', () => {
  const src = read('electron/intelligence/context-os/generationContext.ts');
  assert.match(
    src,
    /retrievedBlockRaw\?:\s*string/,
    'ContextOsGenerationContext must declare an optional retrievedBlockRaw field',
  );
});

test('LLMHelper writes retrievedBlockRaw unconditionally after modeContextBlock is finalized', () => {
  const src = read('electron/LLMHelper.ts');
  assert.match(
    src,
    /retrievedBlockRaw\s*=\s*modeContextBlock/,
    'LLMHelper must write the finalized modeContextBlock onto retrievedBlockRaw regardless of governance state',
  );
  assert.match(
    src,
    /if \(modeContextBlock\)\s*\{[^}]*_cogRetrieved/,
    'the write must be gated on a non-empty modeContextBlock so the field is only populated when retrieval actually ran',
  );
});

test('ipcHandlers prefers the captured retrievedBlockRaw before falling back to independent re-retrieval', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(
    src,
    /_capturedRawBlock\s*=\s*manualContextOsGeneration\?\.retrievedBlockRaw/,
    'ipcHandlers must read the captured raw block from manualContextOsGeneration',
  );
  assert.match(
    src,
    /else if \(_capturedRawBlock && _capturedRawBlock\.trim\(\)\) \{\s*\n\s*docContextBlock = _capturedRawBlock;/,
    'ipcHandlers must use the captured raw block as a docContextBlock source BEFORE the independent re-retrieval branch',
  );
});

test('ipcHandlers still has a re-retrieval fallback for the rare case retrievedBlockRaw is unavailable', () => {
  const src = read('electron/ipcHandlers.ts');
  // The fallback branch must come strictly AFTER the captured-block branch in
  // source order (both start with "else if"/"else" chained off the same if).
  const governedIdx = src.indexOf('if (_governedPack && _governedPack.items.length > 0)');
  const capturedIdx = src.indexOf('else if (_capturedRawBlock && _capturedRawBlock.trim())');
  const fallbackIdx = src.indexOf("else if (!_governedPack) {\n                // Re-retrieve the reference block");
  assert.ok(governedIdx > 0 && capturedIdx > governedIdx && fallbackIdx > capturedIdx,
    'the three branches (governed pack, captured raw block, re-retrieval fallback) must be ordered with re-retrieval last');
});
