// The retrieval query's embedding starts when the interviewer STOPS, not when
// the final transcript lands (~0.7 s later), and the answer's own query embed
// reuses it when its text is the same utterance.
//
// Live 2026-09-27: the hosted query embed for the live meeting index was
// ~450-650 ms of every automatic answer's assembly, on every provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DIST = path.resolve(__dirname, '../../../../dist-electron/electron');
const { EmbeddingPipeline, isNearQueryText } = require(path.join(DIST, 'rag/EmbeddingPipeline.js'));
const { SimpleAutoAnswerEngine } = require(path.join(DIST, 'intelligence/autoAnswer/SimpleAutoAnswer.js'));

const flush = () => new Promise((r) => setImmediate(r));

test('isNearQueryText: the interim a word short of its final, not a different question', () => {
  assert.equal(isNearQueryText('what is the time complexity of your remove', 'What is the time complexity of your remove operation?'), true);
  assert.equal(isNearQueryText('why not just restart the whole cluster on a s', 'Why not just restart the whole cluster on a smaller node?'), true);
  assert.equal(isNearQueryText('what is the time complexity of your remove', 'How would you shard the orders table across regions?'), false);
  assert.equal(isNearQueryText('tell me about yourself', 'Tell me about yourself and then walk me through your last three roles in detail please'), false, 'many more words: embed it on its own');
  assert.equal(isNearQueryText('why', 'why?'), false, 'too short to judge');
});

/** A pipeline with a fake hosted provider; counts real (uncached) query embeds. */
function pipeline({ name = 'natively', space = 'natively:voyage:1024' } = {}) {
  const p = Object.create(EmbeddingPipeline.prototype);
  p.provider = { name, space };
  p.calls = [];
  p.getEmbeddingForQueryUncached = async (text) => { p.calls.push(text); return [text.length, 1, 2]; };
  return p;
}

test('a warmed utterance is reused by its question: one real embed, not two', async () => {
  const p = pipeline();
  p.warmQueryEmbedding('what is the time complexity of your remove');
  await flush();
  const v = await p.getEmbeddingForQuery('What is the time complexity of your remove operation?', { retryBudgetMs: 1200 });
  assert.deepEqual(p.calls, ['what is the time complexity of your remove']);
  assert.deepEqual(v, ['what is the time complexity of your remove'.length, 1, 2]);
  v[0] = -1;   // a caller normalising in place must not corrupt the next reuse
  const again = await p.getEmbeddingForQuery('What is the time complexity of your remove operation?', { retryBudgetMs: 1200 });
  assert.notEqual(again[0], -1);
});

test('a different question embeds on its own', async () => {
  const p = pipeline();
  p.warmQueryEmbedding('what is the time complexity of your remove');
  await flush();
  await p.getEmbeddingForQuery('How would you shard the orders table across regions?');
  assert.equal(p.calls.length, 2);
});

test('a warm vector from another embedding space is never reused', async () => {
  const p = pipeline();
  p.warmQueryEmbedding('what is the time complexity of your remove');
  await flush();
  p.provider = { name: 'gemini', space: 'gemini:embedding-2:768' };
  await p.getEmbeddingForQuery('What is the time complexity of your remove operation?');
  assert.equal(p.calls.length, 2);
});

test('a warm still in flight is JOINED: live, the query arrived ~1 s after the voice stop with the warm still out', async () => {
  const p = pipeline();
  let release;
  p.getEmbeddingForQueryUncached = (text) => { p.calls.push(text); return p.calls.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve([9]); };
  p.warmQueryEmbedding('what is the time complexity of your remove');
  const pending = p.getEmbeddingForQuery('What is the time complexity of your remove operation?', { retryBudgetMs: 1000 });
  release([1, 2]);
  assert.deepEqual(await pending, [1, 2]);
  assert.equal(p.calls.length, 1, 'one real embed for the utterance');
});

test('a warm that fails: the caller runs its own request', async () => {
  const p = pipeline();
  p.getEmbeddingForQueryUncached = (text) => { p.calls.push(text); return p.calls.length === 1 ? Promise.reject(new Error('503')) : Promise.resolve([7]); };
  p.warmQueryEmbedding('what is the time complexity of your remove');
  assert.deepEqual(await p.getEmbeddingForQuery('What is the time complexity of your remove operation?', { retryBudgetMs: 1000 }), [7]);
  assert.equal(p.calls.length, 2);
});

test('a warm slower than the caller\'s budget: the caller stops waiting and runs its own', async () => {
  const p = pipeline();
  p.getEmbeddingForQueryUncached = (text) => { p.calls.push(text); return p.calls.length === 1 ? new Promise(() => {}) : Promise.resolve([5]); };
  p.warmQueryEmbedding('what is the time complexity of your remove');
  const t0 = Date.now();
  assert.deepEqual(await p.getEmbeddingForQuery('What is the time complexity of your remove operation?', { retryBudgetMs: 60 }), [5]);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(p.calls.length, 2);
});

test('an on-device embedder is never warmed (it answers in ~10 ms)', async () => {
  const p = pipeline({ name: 'local', space: 'local:e5-small:384' });
  p.warmQueryEmbedding('what is the time complexity of your remove');
  await flush();
  assert.equal(p.calls.length, 0);
});

test('the engine warms the candidate-to-be when the interviewer stops with words in flight', async () => {
  const clock = new FakeClock();
  const warmed = [];
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [], dispatch: () => {}, judgeCandidate: async () => null, log: () => {},
    warmQuery: (t) => warmed.push(t),
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const seg = (text, final) => engine.ingest({ speaker: 'interviewer', text, final, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
  seg('Okay, next one.', true);
  seg('What is the time complexity of your remove', false);
  engine.onLocalSpeechEnd();
  assert.deepEqual(warmed, ['Okay, next one. What is the time complexity of your remove']);
  // No words in flight (the final already landed): nothing to warm.
  seg('What is the time complexity of your remove operation?', true);
  engine.onLocalSpeechEnd();
  assert.equal(warmed.length, 1);
});

test('main warms through the pipeline with filler words stripped, as the orchestrator strips the question', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../../../../electron/main.ts'), 'utf8');
  assert.match(main, /warmQuery: \(text\) => \{[\s\S]{0,300}stripSttFillers[\s\S]{0,200}warmQueryEmbedding\(stripSttFillers\(text\) \|\| text\)/);
});
