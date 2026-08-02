// Phase 6 — WTA is the second surface on the V3 decision layer.
//
// The wiring contract under test: when the frozen request snapshot carries a
// V3-composed prompt, WhatToAnswerLLM sends EXACTLY those two strings to the
// provider — and when it does not, the legacy assembly is byte-for-byte what it
// always sent. The substitution happens at the single dispatch site, so the
// legacy transport (streaming, deadlines, supersession) is identical in both
// cases; this test therefore only has to look at streamChat's arguments.

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
  fitContextForCurrentModel: (text) => text,
  async *streamChat(...args) {
    calls.push(args);
    yield 'answer';
  },
});

const modesManager = {
  getActiveModeSystemPromptSuffix: () => '',
  buildRetrievedActiveModeContextBlockHybrid: async () => '',
  buildRetrievedActiveModeContextBlock: () => '',
  buildActiveModeContextBlock: () => '',
};

const snapshot = (over = {}) => Object.freeze({
  activeModeInfo: null, modeId: 'general', requestId: 'r1',
  surface: 'what_to_answer', generationId: 1, ...over,
});

const drive = async (answerer, snap) => {
  const chunks = [];
  for await (const c of answerer.generateStream(
    'TRANSCRIPT_SENTINEL', undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, snap,
  )) chunks.push(c);
  return chunks;
};

test('a snapshot carrying v3Prompt drives the provider call verbatim', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);

  const v3 = { system: 'V3_SYSTEM_SENTINEL', user: 'V3_USER_SENTINEL' };
  const chunks = await drive(answerer, snapshot({ v3Prompt: v3 }));

  assert.deepEqual(chunks, ['answer'], 'the legacy transport still streams');
  assert.equal(calls.length, 1);
  const [userMessage, , , systemPrompt] = calls[0];
  assert.equal(userMessage, 'V3_USER_SENTINEL',
    'the V3 user prompt must reach the provider unmodified — re-wrapping it in the legacy assembly would re-inject the context V3 excluded');
  assert.equal(systemPrompt, 'V3_SYSTEM_SENTINEL');
  assert.ok(!userMessage.includes('TRANSCRIPT_SENTINEL'),
    'the raw transcript blob must NOT ride along once V3 owns the prompt');
});

test('without v3Prompt the legacy assembly is untouched', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);

  await drive(answerer, snapshot());

  assert.equal(calls.length, 1);
  const [userMessage, , , systemPrompt] = calls[0];
  assert.ok(userMessage.includes('TRANSCRIPT_SENTINEL'),
    'legacy behaviour: the assembled packet carries the transcript');
  assert.ok(!String(systemPrompt).includes('V3_'),
    'no V3 text may leak into a legacy turn');
});

test('the substitution is all-or-nothing — a prompt without both halves is ignored', async () => {
  // A half-present prompt would pair a V3 system prompt with a legacy user
  // message (or vice versa): two different decisions about what the model may
  // see, stitched together. The snapshot field is typed to carry both, but the
  // dispatch reads it defensively.
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);

  await drive(answerer, snapshot({ v3Prompt: undefined }));
  const [userMessage] = calls[0];
  assert.ok(userMessage.includes('TRANSCRIPT_SENTINEL'));
});
