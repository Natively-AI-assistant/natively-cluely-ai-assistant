// electron/rag/__tests__/EmbeddingPipelineReinitRace.test.mjs
//
// Regression: saving an embedding provider key left every mode reference file
// stuck on `lexical_only`.
//
// The IPC key handlers call ragManager.initializeEmbeddings() (async, not
// awaited) and then appState.scheduleModeReferenceIndexRetry() immediately.
// The retry gates on EmbeddingPipeline.waitForReady(), which used to return the
// moment `this.provider` was non-null. During a RE-initialization the OUTGOING
// provider is still assigned, so waitForReady() resolved instantly against it;
// with the old provider being the cold local MiniLM (isLoaded() === false),
// ModeHybridRetriever.isEmbeddingAvailable() was false and indexFile() re-stamped
// the file `lexical_only` with a NULL embedding space — while the newly resolved
// provider was stamped into app_state a moment later. Observed live: index_state
// rewritten at the exact second of the key save, status `lexical_only`, space
// NULL, app_state = openrouter:nvidia/nemotron-3-embed-1b:free:2048.
//
// Source-level assertions: the pipeline pulls in VectorStore/better-sqlite3, whose
// native binding is built for Electron's ABI, so this cannot be instantiated under
// plain node in this repo (ERR_DLOPEN_FAILED).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const pipelineSrc = fs.readFileSync(path.join(root, 'electron/rag/EmbeddingPipeline.ts'), 'utf8');

describe('EmbeddingPipeline re-initialization race', () => {
  test('an in-flight initialize() is tracked, not inferred from a non-null provider', () => {
    assert.match(pipelineSrc, /private _initializing = false;/, 'the pipeline must track in-flight initialization explicitly');
    assert.match(
      pipelineSrc,
      /this\._initializing = true;\s*\n\s*this\.initPromise = this\._doInitialize\(config\)\.finally\(\(\) => \{ this\._initializing = false; \}\)/,
      'initialize() must set the flag before resolving and clear it when the swap settles',
    );
  });

  test('waitForReady() does NOT short-circuit while a provider swap is in flight', () => {
    const block = pipelineSrc.slice(pipelineSrc.indexOf('async waitForReady('), pipelineSrc.indexOf('getActiveProviderName()'));
    assert.match(block, /if \(this\.provider && !this\._initializing\) return;/, 'the early return must require a settled pipeline');
    assert.doesNotMatch(block, /if \(this\.provider\) return;/, 'the old provider-only early return must not survive');
    assert.match(block, /this\.initPromise/, 'a pending initialization must still be awaited');
  });

  test('the flag clears on a FAILED initialization too (no permanent hang)', () => {
    // .finally() — not .then() — so a provider-resolution throw still releases
    // every waitForReady() caller instead of stalling them until the timeout.
    assert.match(pipelineSrc, /_doInitialize\(config\)\.finally\(/);
  });

  test('the retry that depends on this still gates on waitForReady', () => {
    const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const block = mainSrc.slice(mainSrc.indexOf('public scheduleModeReferenceIndexRetry'), mainSrc.indexOf('private async bootstrapOllamaEmbeddings'));
    assert.match(block, /pipeline\.waitForReady\(15000\)[\s\S]*retryAllLexicalOnlyFiles/, 'the reference-file retry must run after the pipeline is ready');
  });
});
