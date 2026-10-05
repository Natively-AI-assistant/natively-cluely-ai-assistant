// electron/services/__tests__/StreamPaintsEveryToken2026_09_27.test.mjs
//
// Live 2026-09-27 (Auto Answer, Natively): answers reached the overlay in
// 160-167-char lumps 120-230 ms apart. The non-coding paint path held the first
// paint until 160 chars (the "safe prefix") and then RESET its buffer, so every
// later paint waited for another 160 too: the first lump cost ~250-400 ms after
// the first token, and a short answer painted only when it had finished.
//
// Fix under test: the first paint waits for 40 chars (past the longest
// non-answer sentinel, 29), then every token paints as it arrives. The guards
// the prefix protected still hold: a canned opener and a non-answer sentinel
// never paint (their own tests), a scaffold still holds (ScaffoldStreamHold).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

async function run(tokens) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, new SessionTracker());
  const state = { yielded: 0 };
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const t of tokens) { state.yielded += t.length; yield t; }
    },
  };
  const paints = [];
  engine.on('suggested_answer_token', (token) => paints.push({ token, yieldedBefore: state.yielded }));
  await engine.runWhatShouldISay('When would you use a mutex?', 0.9, undefined, { skipCooldown: true });
  return paints;
}

const ANSWER = 'A mutex, short for mutual exclusion, is used when multiple threads need to access a shared resource, '
  + 'like a counter, a list, or a file, and at least one of them writes to it. Without it, two threads can '
  + 'interleave their read, modify, and write steps and corrupt the data, so you lock the critical section.';
// Word-sized tokens, the way the provider streams.
const TOKENS = ANSWER.match(/\S+\s*/g);

test('the first paint comes at ~40 chars, not 160', async () => {
  const paints = await run(TOKENS);
  assert.ok(paints.length > 0);
  assert.ok(paints[0].yieldedBefore < 60, `first paint after ${paints[0].yieldedBefore} chars had streamed`);
});

test('after the first paint, the answer streams token by token, not in 160-char lumps', async () => {
  const paints = await run(TOKENS);
  const later = paints.slice(1).filter((p) => p.token.trim());
  assert.ok(later.length > 20, `expected a paint per token, got ${later.length} paints`);
  assert.ok(Math.max(...later.map((p) => p.token.length)) < 40, 'no lump');
  assert.equal(paints.map((p) => p.token).join('').trim(), ANSWER.trim(), 'every character painted once, in order');
});

test('a short complete answer paints before the stream ends', async () => {
  const short = 'Use a mutex whenever two threads write the same counter, list or file.';
  const tokens = short.match(/\S+\s*/g);
  const paints = await run(tokens);
  assert.ok(paints[0].yieldedBefore < short.length, 'it used to wait for the whole answer when under 160 chars');
});
