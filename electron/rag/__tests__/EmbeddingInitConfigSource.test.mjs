// electron/rag/__tests__/EmbeddingInitConfigSource.test.mjs
//
// Every embedding re-initialization must build its config the SAME way.
//
// THE BUG: ProcessingHelper re-initialized embeddings with a hand-picked subset
// — `{ openaiKey, geminiKey, providerDataScopes }` — and nothing else. It ran
// after the correct startup init and CLOBBERED it, silently dropping:
//   nativelyApiKey, ollamaUrl, every model/dims field, and (fatally) the user's
//   embeddingMode / embeddingProvider selection.
//
// Observed: settings held {mode:'manual', provider:'natively'}, yet the pipeline
// resolved gemini, because by the time it resolved, the config in play was the
// subset — which has no concept of a chosen provider. Selecting a model in
// Settings appeared to do nothing.
//
// A hand-maintained field list is the defect. buildEmbeddingConfig() is the one
// place that knows how to assemble this, so every caller must use it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = p => readFileSync(path.join(root, p), 'utf8');

/** Every call site that re-initializes embeddings at runtime. */
const CALLERS = ['electron/ProcessingHelper.ts', 'electron/ipcHandlers.ts', 'electron/main.ts'];

describe('every initializeEmbeddings caller uses the shared builder', () => {
  for (const file of CALLERS) {
    test(`${file} does not hand-roll an embedding config`, () => {
      const src = read(file);
      let from = 0;
      for (;;) {
        const i = src.indexOf('initializeEmbeddings(', from);
        if (i === -1) break;
        from = i + 1;
        // The argument list, up to a plausible end of the call.
        const call = src.slice(i, i + 400);
        // A literal object argument means the fields were typed out by hand.
        const handRolled = /initializeEmbeddings\(\s*\{/.test(call);
        assert.equal(handRolled, false,
          `${file} passes a hand-written object to initializeEmbeddings; use buildEmbeddingConfig() so no field can be forgotten:\n${call.slice(0, 200)}`);
      }
    });
  }

  test('ProcessingHelper specifically routes through buildEmbeddingConfig', () => {
    // It is the caller that had the bug, and it runs on every key load.
    const src = read('electron/ProcessingHelper.ts');
    assert.match(src, /buildEmbeddingConfig/);
  });
});

describe('the selection is visible in the logs', () => {
  test('the init log reports the chosen mode and provider', () => {
    // Without these the log shows six credential booleans and nothing about the
    // decision that actually picks the provider — the exact reason this took a
    // full runtime trace to find.
    const src = read('electron/rag/EmbeddingPipeline.ts');
    const i = src.indexOf('Initializing with config');
    assert.notEqual(i, -1);
    // Slice to the end of the object literal, not a guessed char count: a fixed
    // window silently truncates as the block grows, so the assertion starts
    // testing "did it fit" instead of "is it there".
    const end = src.indexOf('});', i);
    assert.notEqual(end, -1);
    const block = src.slice(i, end);
    assert.match(block, /embeddingMode/);
    assert.match(block, /embeddingProvider/);
  });
});

describe('the resolver does not claim a next candidate it does not have', () => {
  test('"trying next" is only logged when another candidate remains', () => {
    // Printed unconditionally, it reads as "the chain continued" even when the
    // list was exhausted — which is what made a single-candidate manual
    // selection look like an auto-mode fallthrough.
    const src = read('electron/rag/EmbeddingProviderResolver.ts');
    assert.doesNotMatch(src, /^\s*console\.log\(`\[EmbeddingProviderResolver\] Provider \$\{provider\.name\} unavailable, trying next\.\.\.`\);\s*$/m);
  });
});
