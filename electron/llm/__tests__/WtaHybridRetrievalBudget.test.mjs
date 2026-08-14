// electron/llm/__tests__/WtaHybridRetrievalBudget.test.mjs
//
// Latency regression (audit: hybrid-retrieval-await-unbudgeted-30s).
// The mode-context hybrid retrieval embeds the live query; the embedder's own
// hard timeout is 30s. On the WTA path that await sits BEFORE the first answer
// token. WhatToAnswerLLM now caps it (HYBRID_RETRIEVAL_BUDGET_MS=1500) and falls
// through to the synchronous lexical retriever. This test proves a HANGING
// hybrid retrieval does NOT block first-useful-token: the stream still produces
// output well under the embedder's 30s ceiling, using the lexical fallback.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distWhatToAnswerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js');
const require = createRequire(import.meta.url);

const makeLLMHelper = (calls) => ({
  getCapabilities: () => ({ outputBudgetTokens: 2000 }),
  getPromptTier: () => 'full',
  fitContextForCurrentModel: text => text,
  async *streamChat(...args) {
    calls.push(args);
    yield 'answer';
  },
});

test('a hanging hybrid retrieval does NOT block the WTA stream (lexical fallback within budget)', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  let lexicalUsed = false;

  const modesManager = {
    getActiveModeSystemPromptSuffix: () => '',
    // Hybrid hangs "forever" (simulates a cold/rate-limited embedder ~30s).
    buildRetrievedActiveModeContextBlockHybrid: () => new Promise(() => {}),
    buildRetrievedActiveModeContextBlock: () => { lexicalUsed = true; return 'LEXICAL_FALLBACK_CONTEXT'; },
    buildActiveModeContextBlock: () => '',
  };

  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);

  const start = Date.now();
  const chunks = [];
  for await (const chunk of answerer.generateStream('CURRENT_TRANSCRIPT_SENTINEL')) {
    chunks.push(chunk);
  }
  const elapsed = Date.now() - start;

  assert.deepEqual(chunks, ['answer'], 'stream still produces an answer');
  assert.equal(calls.length, 1, 'streamChat was reached despite the hung hybrid retrieval');
  assert.ok(lexicalUsed, 'fell back to the synchronous lexical retriever');
  // Must clear the gate well under the 30s embedder ceiling. The budget is
  // 1500ms; allow generous headroom for slow CI but far below 30s.
  assert.ok(elapsed < 5000, `WTA must not block on the hung embedder; took ${elapsed}ms`);
});

test('a fast hybrid retrieval is used directly (no premature fallback)', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  let lexicalUsed = false;

  const modesManager = {
    getActiveModeSystemPromptSuffix: () => '',
    buildRetrievedActiveModeContextBlockHybrid: async () => 'HYBRID_CONTEXT_FAST',
    buildRetrievedActiveModeContextBlock: () => { lexicalUsed = true; return 'LEXICAL'; },
    buildActiveModeContextBlock: () => '',
  };

  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);
  const chunks = [];
  for await (const chunk of answerer.generateStream('CURRENT_TRANSCRIPT_SENTINEL')) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ['answer']);
  assert.equal(lexicalUsed, false, 'fast hybrid result is used; no lexical fallback');
  // The hybrid context should have reached the user message (3rd arg is undefined;
  // mode context flows through the assembled packet user message — arg 0).
  assert.match(calls[0][0], /HYBRID_CONTEXT_FAST/, 'hybrid context is included in the prompt');
});
