// Phase 6 — the proactive surfaces (assist / clarify / brainstorm) on V3.
//
// Contract: when the engine resolved a transcript question and the bridge
// composed a prompt, each LLM sends EXACTLY those strings; with no override the
// legacy prompt/context pair is untouched. The engine only produces an override
// when question-resolver confidently extracts a question — the genuinely
// proactive case (no question on the table) keeps legacy behaviour, because
// degrading proactivity into no-evidence disclosures would be adoption theatre.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (n) => path.resolve(__dirname, `../../../dist-electron/electron/llm/${n}.js`);

const makeLLMHelper = (calls) => ({
  getPromptTier: () => 'full',
  fitContextForCurrentModel: (t) => t,
  async *streamChat(...args) { calls.push(args); yield 'tok'; },
});

const V3 = { system: 'V3_SYS', user: 'V3_USER' };

test('AssistLLM: override drives the provider; absence keeps legacy', async () => {
  const { AssistLLM } = require(dist('AssistLLM'));
  const calls = [];
  const llm = new AssistLLM(makeLLMHelper(calls));
  await llm.generate('CTX', undefined, V3);
  await llm.generate('CTX', undefined, undefined);
  // AssistLLM's arg0 is an INSTRUCTION (its context rides in arg2), so under V3
  // the composed user prompt becomes the message and the raw blob is dropped.
  assert.equal(calls[0][0], 'V3_USER');
  assert.equal(calls[0][2], undefined, 'the raw context blob must NOT ride along under V3');
  assert.equal(calls[0][3], 'V3_SYS');
  // Legacy: instruction as message, context in arg2 — untouched.
  assert.match(calls[1][0], /summarize what is happening/i);
  assert.equal(calls[1][2], 'CTX', 'legacy context untouched without the override');
  assert.notEqual(calls[1][3], 'V3_SYS');
});

test('ClarifyLLM: both paths honour the override', async () => {
  const { ClarifyLLM } = require(dist('ClarifyLLM'));
  const calls = [];
  const llm = new ClarifyLLM(makeLLMHelper(calls));
  for await (const _ of llm.generateStream('CTX', V3)) { /* drain */ }
  for await (const _ of llm.generateStream('CTX')) { /* drain */ }
  assert.equal(calls[0][0], 'V3_USER');
  assert.equal(calls[0][3], 'V3_SYS');
  assert.equal(calls[1][0], 'CTX');
});

test('BrainstormLLM: override drives the provider', async () => {
  const { BrainstormLLM } = require(dist('BrainstormLLM'));
  const calls = [];
  const llm = new BrainstormLLM(makeLLMHelper(calls));
  for await (const _ of llm.generateStream('CTX', undefined, V3)) { /* drain */ }
  assert.equal(calls[0][0], 'V3_USER');
  assert.equal(calls[0][3], 'V3_SYS');
});

test('question-resolver gates the proactive adoption: no stable question, no takeover', async () => {
  const { resolveQuestion } = require(path.resolve(__dirname, '../../../dist-electron/electron/context-intelligence/question/question-resolver.js'));
  // Ambient chatter with no question — the engine helper returns null here and
  // the surface stays legacy-proactive.
  const chatter = resolveQuestion({ transcript: [
    { role: 'interviewer', text: 'So yeah, the weather has been great lately.', timestamp: 1 },
    { role: 'user', text: 'Absolutely, really nice out.', timestamp: 2 },
  ] });
  assert.ok(!chatter.resolvedQuestion || chatter.requiresClarification || chatter.confidence < 0.6,
    `ambient chatter must not resolve to a confident question: ${JSON.stringify(chatter)}`);
  // A real interviewer question resolves confidently.
  const q = resolveQuestion({ transcript: [
    { role: 'interviewer', text: 'Tell me about your experience with WebRTC?', timestamp: 3 },
  ] });
  assert.ok(q.resolvedQuestion && q.confidence >= 0.6 && !q.requiresClarification,
    `a direct question must resolve: ${JSON.stringify(q)}`);
});
