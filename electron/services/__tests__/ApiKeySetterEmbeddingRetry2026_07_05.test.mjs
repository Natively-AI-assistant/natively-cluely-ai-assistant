/**
 * Regression tests for the "reference files not indexing" / "modes not
 * indexing" bug reported 2026-07-05.
 *
 * ROOT CAUSE: `set-gemini-api-key` and `set-openai-api-key` updated the CHAT
 * client immediately (llmHelper.setApiKey / setOpenaiApiKey) but never told
 * RAGManager's EmbeddingPipeline about the new key. Only two call sites ever
 * called `ragManager.initializeEmbeddings(...)`:
 *   - ProcessingHelper.loadStoredCredentials() — boot time only.
 *   - AppState.bootstrapOllamaEmbeddings() — after a successful Ollama model
 *     pull, which also calls appState.scheduleModeReferenceIndexRetry() so
 *     any reference file previously marked lexical_only gets re-embedded.
 * A key entered live via the Settings UI (the common real-world path — most
 * users don't have the key in an env var at first launch) never reached the
 * embedder. Reference files kept indexing as lexical_only, and
 * ModeHybridRetriever kept logging "Embedding provider unavailable, using
 * lexical fallback" for the rest of the session, until the user restarted
 * the app (which re-runs loadStoredCredentials at boot).
 *
 * FIX: both handlers now call `ragManager.initializeEmbeddings(...)` +
 * `appState.scheduleModeReferenceIndexRetry()` when the key actually changed
 * — mirroring the exact pattern already proven at the Ollama-pull completion
 * site (main.ts bootstrapOllamaEmbeddings).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function handlerBlock(source, handlerName) {
  const handlerStart = source.indexOf(`safeHandle('${handlerName}'`);
  assert.ok(handlerStart >= 0, `${handlerName} handler must exist in ipcHandlers.ts`);
  const nextHandlerStart = source.indexOf('safeHandle(', handlerStart + 1);
  return source.slice(handlerStart, nextHandlerStart > handlerStart ? nextHandlerStart : handlerStart + 1600);
}

const EMBEDDING_KEY_HANDLERS = ['set-gemini-api-key', 'set-openai-api-key'];

for (const handlerName of EMBEDDING_KEY_HANDLERS) {
  test(`${handlerName} IPC handler re-initializes RAGManager embeddings and retries lexical_only files when the key changes`, () => {
    const source = read('electron/ipcHandlers.ts');
    const block = handlerBlock(source, handlerName);

    assert.match(
      block,
      /ragManager\.initializeEmbeddings\(/,
      `${handlerName} must call ragManager.initializeEmbeddings() so a live-entered key reaches the embedder, not just the chat client`,
    );
    assert.match(
      block,
      /appState\.scheduleModeReferenceIndexRetry\(\)/,
      `${handlerName} must call appState.scheduleModeReferenceIndexRetry() so reference files previously marked lexical_only get re-embedded once the new key resolves`,
    );
    // The re-init must be gated on keyChanged (not run on every re-save of the
    // same key) — mirrors the existing Hindsight-notify gating in this file.
    assert.match(
      block,
      /if\s*\(keyChanged\)\s*\{[\s\S]*?ragManager\.initializeEmbeddings/,
      `${handlerName} must gate the embedding re-init on keyChanged, matching the existing Hindsight-notify pattern in the same handler`,
    );
  });
}

test('set-groq-api-key IPC handler does not need embedding re-init (Groq is not an embedding provider in this codebase)', () => {
  // Documents the intentional omission so reviewers don't add
  // ragManager.initializeEmbeddings() there — Groq only serves chat/completions,
  // never embeddings, in EmbeddingProviderResolver.
  const source = read('electron/ipcHandlers.ts');
  const block = handlerBlock(source, 'set-groq-api-key');
  assert.doesNotMatch(block, /ragManager\.initializeEmbeddings\(/);
});
