// Phase 6 — the proactive surface (assist) on V3. Clarify and Brainstorm left: see below.
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

// Clarify left this contract on 2026-10-09. V3 composes an ANSWER prompt (it
// says never to ask the user to clarify), and Clarify sent with it answered the
// question instead of asking one, 15 runs of 15 on three models. The full case
// is QuickActionTurnRequest2026_10_09.test.mjs.
// There is no override parameter left to pass (the engine's source is pinned in
// that file), so this states what Clarify does send.
test('ClarifyLLM: sends its own prompt and the transcript context', async () => {
  const { ClarifyLLM } = require(dist('ClarifyLLM'));
  const calls = [];
  for await (const _ of new ClarifyLLM(makeLLMHelper(calls)).generateStream('CTX')) { /* drain */ }
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].includes('CTX'), 'the transcript context is what Clarify sends');
  assert.equal(calls[0][9], undefined, 'not a V3-owned turn');
});

// Brainstorm left this contract on 2026-10-09 too, for the same reason: sent
// with V3's answer prompt it was a second Answer button (23 replies of 90
// weighed two or more approaches; with its own prompt and the request in the
// turn, 90 of 90). The full case is BrainstormOwnPrompt2026_10_09.test.mjs.
test('BrainstormLLM: sends its own prompt and the transcript context', async () => {
  const { BrainstormLLM } = require(dist('BrainstormLLM'));
  const calls = [];
  for await (const _ of new BrainstormLLM(makeLLMHelper(calls)).generateStream('CTX')) { /* drain */ }
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].includes('CTX'), 'the transcript context is what Brainstorm sends');
  assert.equal(calls[0][9], undefined, 'not a V3-owned turn');
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
