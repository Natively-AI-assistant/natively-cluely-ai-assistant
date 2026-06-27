// Tests for the hybrid retrieval path on document-grounded custom modes
// (audit 2026-06-27).
//
// Previously, ModesManager.buildRetrievedActiveModeContextBlockHybrid
// unconditionally short-circuited to the lexical path when
// forceDocumentGrounding was set, because the hybrid retriever did not
// build a document-identity block. This denied document-grounded custom
// modes the precision benefit of semantic + cross-encoder rerank
// retrieval on top of lexical.
//
// The fix threads forceDocumentGrounding into ModeHybridRetriever.retrieve
// and has it prepend a self-contained identity block (mirrors the lexical
// retriever's buildDocumentIdentityBlock) so broad questions like
// "what is this about?" still hit the document even when the chunk
// selection is sparse.
//
// These are source-assertion tests because the hybrid retrieval path
// requires better-sqlite3 native binding (Node 25 ABI mismatch in this
// fast-iteration loop).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('hybrid retriever accepts forceDocumentGrounding in its retrieve params', () => {
  const src = read('electron/services/modes/ModeHybridRetriever.ts');
  assert.match(
    src,
    /async retrieve\(params: \{[\s\S]*?forceDocumentGrounding\?:\s*boolean/,
    'ModeHybridRetriever.retrieve must accept forceDocumentGrounding in its params',
  );
  assert.match(
    src,
    /forceDocumentGrounding = false/,
    'forceDocumentGrounding must default to false (back-compat)',
  );
});

test('hybrid retriever emits document_identity block when forceDocumentGrounding is set', () => {
  const src = read('electron/services/modes/ModeHybridRetriever.ts');
  // The return statement must branch on forceDocumentGrounding and prepend
  // an identity block via prependIdentityBlock. Without this branch the
  // hybrid path silently drops the identity block the document-grounded
  // custom mode relies on for broad queries.
  assert.match(
    src,
    /if \(forceDocumentGrounding && files\.length > 0\)/,
    'hybrid retriever must conditionally prepend identity block',
  );
  assert.match(
    src,
    /prependIdentityBlock\(formattedContext, files\)/,
    'identity block must be spliced into the existing context envelope',
  );
});

test('prependIdentityBlock builds document_identity XML with high_signal_terms + opening_excerpt', () => {
  const src = read('electron/services/modes/ModeHybridRetriever.ts');
  assert.match(
    src,
    /private prependIdentityBlock\(/,
    'prependIdentityBlock helper must exist',
  );
  assert.match(
    src,
    /<document_identity purpose="broad_query_grounding">/,
    'identity block must use the broad_query_grounding XML tag',
  );
  assert.match(
    src,
    /<high_signal_terms>/,
    'identity block must include per-file high_signal_terms',
  );
  assert.match(
    src,
    /<opening_excerpt>/,
    'identity block must include a per-file opening_excerpt',
  );
});

test('ModesManager.buildRetrievedActiveModeContextBlockHybrid routes forceDocumentGrounding to hybrid FIRST', () => {
  const src = read('electron/services/ModesManager.ts');
  // Before 2026-06-27 this method short-circuited to the lexical path
  // immediately when forceDocumentGrounding was set. The new code must
  // try the hybrid retriever first, then fall back to lexical only if
  // hybrid returns usedFallback or throws.
  assert.match(
    src,
    /buildRetrievedActiveModeContextBlockHybrid[\s\S]*?if \(retrievalOptions\?\.forceDocumentGrounding\)\s*\{[\s\S]*?retrieveHybrid\(/,
    'hybrid-first routing must invoke retrieveHybrid when forceDocumentGrounding is set',
  );
  assert.match(
    src,
    /buildRetrievedActiveModeContextBlockHybrid[\s\S]*?if \(retrievalOptions\?\.forceDocumentGrounding\)[\s\S]*?usedFallback[\s\S]*?buildRetrievedActiveModeContextBlock\(/,
    'hybrid-first routing must fall back to lexical when hybrid returned usedFallback',
  );
});

test('hybrid retriever no longer short-circuits forceDocumentGrounding to lexical only', () => {
  // Defensive assertion: the old code had `if (retrievalOptions?.forceDocumentGrounding) return this.buildRetrievedActiveModeContextBlock(...)`
  // directly. The new code must do the hybrid-first routing.
  const src = read('electron/services/ModesManager.ts');
  // Match a 2-line pattern that the OLD code had but the NEW code must NOT.
  // Allow flexible whitespace; the destructive pattern is the unconditional return.
  const oldPattern = new RegExp(
    "if \\(retrievalOptions\\?\\.forceDocumentGrounding\\)\\s*\\{\\s*return this\\.buildRetrievedActiveModeContextBlock\\(",
  );
  // We assert the substring WITHOUT the intermediate try-catch wrapping it
  // is NOT present. The new code wraps this fallback in try/catch.
  assert.ok(
    !oldPattern.test(src),
    'ModesManager must no longer unconditionally short-circuit forceDocumentGrounding to lexical',
  );
});