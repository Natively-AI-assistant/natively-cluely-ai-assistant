// electron/services/__tests__/ScaffoldStreamHold2026_08_21.test.mjs
//
// RC-4 regression from live shadow session C (2026-08-21): 23 presses
// streamed a "## Approach…" template draft to the screen token-by-token and
// then visibly REPLACED it with the post-repair rewrite (23/23 final answers
// differed from the streamed raw; 17 shrank below 60%; one substantive answer
// was replaced by a refusal). The user experiences this as "first an answer
// shows, then gets replaced with the correct answer later".
//
// Fix under test: for NON-coding turns, a stream whose first visible
// characters are a markdown heading (the scaffold-misfire shape — a spoken
// answer never legitimately opens with one) is HELD: no token paints while
// the provider streams; the first thing the user sees is the post-repair
// final. Clean prose answers stream exactly as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

async function makeEngine(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  const state = { streamDone: false };
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
      state.streamDone = true;
    },
  };
  return { engine, session, state };
}

// Long enough to cross the 160-char streaming safe prefix several times, so a
// non-held run provably paints DURING the stream.
const SCAFFOLD_ANSWER = [
  '## Approach\n- A semaphore is a synchronization primitive that controls access to a shared resource by maintaining a count and allowing N concurrent accessors instead of one.\n\n',
  '## Technique / Data Structure / Algorithm Used\n- Counting semaphore, blocking queue of waiters.\n\n',
  '## Dry Run\nNot applicable, conceptual question.\n\n',
  '## Complexity\nNot applicable, conceptual question.\n\n',
  'A semaphore is a counter that controls how many threads can access a resource at the same time.',
];

const CLEAN_ANSWER = [
  'A mutex, short for mutual exclusion, is used when multiple threads need to access a shared resource, ',
  'like a counter, a list, or a file, and at least one of them writes to it. Without it, two threads can ',
  'interleave their read, modify, and write steps and corrupt the data, so you lock the critical section.',
];

test('RC-4: a scaffold-opening stream paints NOTHING until the provider stream is done', async () => {
  const { engine, state } = await makeEngine(SCAFFOLD_ANSWER);
  const paintsDuringStream = [];
  engine.on('suggested_answer_token', (token) => {
    if (!state.streamDone) paintsDuringStream.push(token);
  });
  let final = null;
  engine.on('suggested_answer', (answer) => { final = answer; });

  await engine.runWhatShouldISay("Okay. So what's a semaphore?", 0.9, undefined, { skipCooldown: true });

  assert.deepEqual(paintsDuringStream, [],
    'the scaffold draft must never paint while streaming — the visible answer-swap was the live defect');
  assert.ok(final && final.length > 0, 'a final answer must still be delivered');
});

test('review 2026-08-22: a PROMOTED screen-coding turn streams via the coding gate and is never regenerated', async () => {
  // A deictic press over on-screen code keeps a non-coding answerType while
  // the prompt is promoted to the coding contract. The engine's gates now
  // consult the same shared predicate: the six-section answer must (a) still
  // paint during the stream (codingGate, not the RC-4 hold) and (b) never
  // trigger the scaffold-regeneration second LLM call.
  const { engine, state } = await makeEngine(SCAFFOLD_ANSWER);
  const regenCalls = [];
  engine.llmHelper.streamChat = (...args) => { regenCalls.push(args); return (async function* () { yield 'rewrite'; })(); };
  const paintsDuringStream = [];
  engine.on('suggested_answer_token', (token) => {
    if (!state.streamDone) paintsDuringStream.push(token);
  });
  let final = null;
  engine.on('suggested_answer', (answer) => { final = answer; });

  await engine.runWhatShouldISay('how do I solve this?', 0.9, undefined, {
    skipCooldown: true,
    domContext: 'class Solution:\n    def twoSum(self, nums, target):\n        pass',
  });

  assert.ok(paintsDuringStream.length > 0,
    'a promoted coding answer must stream (the hold treating it as a misfire was the confirmed finding)');
  assert.equal(regenCalls.length, 0, 'the scaffold regeneration must not fire on a promoted turn');
  assert.match(final ?? '', /## Approach/, 'the six-section answer is the CORRECT shape here and must survive');
});

test('RC-4: a clean prose stream still paints live (no lost streaming)', async () => {
  const { engine, state } = await makeEngine(CLEAN_ANSWER);
  const paintsDuringStream = [];
  engine.on('suggested_answer_token', (token) => {
    if (!state.streamDone) paintsDuringStream.push(token);
  });

  await engine.runWhatShouldISay('When would you use a mutex?', 0.9, undefined, { skipCooldown: true });

  assert.ok(paintsDuringStream.length > 0,
    'clean answers must keep streaming token-by-token — holding them would regress perceived latency');
});
