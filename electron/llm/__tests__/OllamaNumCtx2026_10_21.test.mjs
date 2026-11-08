// Ollama runs a model at its own default context window, 4096 tokens on any
// machine with under 24 GiB of VRAM (docs.ollama.com/context-length), unless the
// request sends options.num_ctx. Natively sent none and trimmed prompts to
// 32k-128k, so the ~6k-token system prompt alone overflowed and Ollama dropped
// the start of the prompt without an error: answers that ignored the mode and
// the context. Both Ollama request bodies now send num_ctx, and every trim uses
// that same number (ollamaRequestContext). Platform independent.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/OllamaNumCtx2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { ollamaRequestContext, getModelCapabilities } = require(path.join(repoRoot, 'dist-electron/electron/llm/modelCapabilities.js'));

test('7B+ models ask for 16k, small ones 8k, never more than the native window', () => {
  assert.equal(ollamaRequestContext('llama3.1:8b', {}), 16_384);
  assert.equal(ollamaRequestContext('qwen2.5-coder:7b', {}), 16_384);
  assert.equal(ollamaRequestContext('qwen3:4b', {}), 8_192, 'a 4B is local-small: the 8k cap, inside qwen3\'s 32k native window');
  assert.equal(ollamaRequestContext('llama3:8b', {}), 8_000, 'llama3 (no .1) is natively 8k');
  for (const id of ['llama3.1:8b', 'gemma2:2b', 'mistral:7b', 'phi3:mini', 'unknown-model']) {
    const n = ollamaRequestContext(id, {});
    assert.ok(n > 4096, `${id}: must be above Ollama's 4096 default, got ${n}`);
    assert.ok(n <= getModelCapabilities(id, true).maxContextTokens, `${id}: within the native window`);
  }
});

test('OLLAMA_NUM_CTX overrides the cap but not the native window; junk is ignored', () => {
  assert.equal(ollamaRequestContext('llama3.1:70b', { OLLAMA_NUM_CTX: '65536' }), 65_536);
  assert.equal(ollamaRequestContext('llama3:8b', { OLLAMA_NUM_CTX: '65536' }), 8_000);
  for (const junk of ['', 'abc', '-5', '0', '1.5']) {
    assert.equal(ollamaRequestContext('llama3.1:8b', { OLLAMA_NUM_CTX: junk }), 16_384, `OLLAMA_NUM_CTX=${JSON.stringify(junk)}`);
  }
});

test('both Ollama request bodies send num_ctx, and each trims to the same number', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/LLMHelper.ts'), 'utf8');

  const call = src.slice(src.indexOf('const ollamaModel = (images && this.localVisionOverride(imagePaths)) || this.ollamaModel;'));
  const callBody = call.slice(0, call.indexOf('/api/chat'));
  assert.match(callBody, /const maxCtx = ollamaRequestContext\(ollamaModel\);/);
  assert.match(callBody, /num_ctx: maxCtx,/);

  const stream = src.slice(src.indexOf('// --- OLLAMA STREAMING'));
  const streamBody = stream.slice(0, stream.indexOf('/api/chat`'));
  assert.match(streamBody, /const ollamaNumCtx = ollamaRequestContext\(ollamaModel\);/);
  assert.match(streamBody, /const maxCtx = ollamaNumCtx;/);
  assert.match(streamBody, /num_ctx: ollamaNumCtx,/);

  const fit = src.slice(src.indexOf('public fitContextForCurrentModel('));
  assert.match(fit.slice(0, fit.indexOf('if (maxContextTokens >= 100_000)')), /this\.useOllama \? ollamaRequestContext\(modelId\)/);
});
