// Regression: the manual "What to answer" path must never return a non-null
// answer string WITHOUT also emitting a render signal.
//
// The renderer (NativelyInterface.handleWhatToSay) renders the answer from the
// 'suggested_answer' EVENT; the IPC return value's non-null answer is only used
// to detect the null/empty-feedback case. So an engine return path that returns
// a non-null string but emits NOTHING leaves the thinking-dots placeholder
// hanging forever — the user sees "no response at all". Two such silent
// dead-ends existed (no API key configured; empty legacy-answerLLM result).
// These tests pin that every manual outcome either emits or returns null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

const makeHelper = () => ({ setNegotiationCoachingHandler() {} });

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  return { engine, session };
}

test('no LLM configured: manual WTA EMITS the config message (never a silent non-null return)', async () => {
  const { engine } = await makeEngine();
  // Force the unconfigured state.
  engine.whatToAnswerLLM = null;
  engine.answerLLM = null;

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { skipCooldown: true });

  // INVARIANT: a non-null answer must have been emitted so the renderer shows it.
  assert.ok(answer && answer.includes('API Keys'), 'returns the config message');
  assert.equal(emitted.length, 1, 'must emit exactly one suggested_answer so the placeholder resolves');
  assert.equal(emitted[0], answer, 'emitted text matches the returned answer');
});

test('no LLM configured + speculative: does NOT emit (no placeholder exists for speculation)', async () => {
  const { engine } = await makeEngine();
  engine.whatToAnswerLLM = null;
  engine.answerLLM = null;

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  // Speculative runs bypass the cooldown via isSpeculative and have no UI placeholder.
  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { speculative: true });
  assert.ok(answer && answer.includes('API Keys'));
  assert.equal(emitted.length, 0, 'speculative path must not emit a user-facing answer');
});

test('legacy answerLLM returns empty: manual WTA returns null (renderer shows null-feedback, no silent dots)', async () => {
  const { engine } = await makeEngine();
  // whatToAnswerLLM absent but answerLLM present and yielding an empty answer.
  engine.whatToAnswerLLM = null;
  engine.answerLLM = { async generate() { return ''; } };

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { skipCooldown: true });

  // INVARIANT: empty answer -> null return (renderer's null branch shows feedback),
  // NOT a non-null fallback string that would render nowhere.
  assert.equal(answer, null, 'empty legacy answer must return null, not a silent fallback string');
  assert.equal(emitted.length, 0, 'nothing emitted; renderer handles null itself');
});

test('legacy answerLLM returns a real answer: emits it and returns it', async () => {
  const { engine } = await makeEngine();
  engine.whatToAnswerLLM = null;
  engine.answerLLM = { async generate() { return 'A real grounded answer.'; } };

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { skipCooldown: true });
  assert.equal(answer, 'A real grounded answer.');
  assert.deepEqual(emitted, ['A real grounded answer.']);
});
