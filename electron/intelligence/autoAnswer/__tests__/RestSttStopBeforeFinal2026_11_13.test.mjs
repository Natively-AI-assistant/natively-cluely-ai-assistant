/**
 * REST STT providers (Groq, Azure, IBM Watson, OpenAI whisper-1, local
 * whisper) produce a FINAL only after the speech ended, so the local voice
 * detector's stop always comes first. Treating that stop as an endpoint at the
 * moment it fires would judge the turn without its last words, so those
 * providers never got the hint and every turn paid the full STABILITY_MS hold
 * (pipeline forensics 2026-11-13, F-LAT-07: REST1-3-s02 dispatch 1555 ms vs
 * verdict 1236 ms).
 *
 * The stop is still valid evidence for the final that follows it: a final
 * that lands while the voice detector says the interviewer is silent (no
 * speech start since the stop) closes the turn at ENDPOINT_CONFIRM_MS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repo = path.resolve(__dirname, '../../../..');
const { SimpleAutoAnswerEngine, STABILITY_MS, ENDPOINT_CONFIRM_MS } = require(path.join(repo, 'dist-electron/electron/intelligence/autoAnswer/SimpleAutoAnswer.js'));

const flush = () => new Promise((r) => setImmediate(r));
// A fast judge (0.4 s), so the commit hold is what decides the dispatch time.
function rig() {
  const clock = new FakeClock();
  const state = { dispatchedAt: [], judged: [] };
  const engine = new SimpleAutoAnswerEngine({
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q) => { state.dispatchedAt.push({ text: q.text, at: clock.now() }); },
    judgeCandidate: (req) => { state.judged.push(req.candidateText); return new Promise((r) => clock.setTimeout(() => r(JSON.stringify(req.candidateText.includes('?')
      ? { is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null, action: 'answer' }
      : { is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0.1, question_text: null, action: 'silent' })), 400)); },
    telemetry: () => {}, log: () => {},
  }, clock);
  engine.onMeetingStart();
  const final = (text) => engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt' });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(50, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { engine, clock, state, final, advance };
}

const Q = 'What is the difference between a process and a thread?';

test('a REST final after the voice stop commits at ENDPOINT_CONFIRM_MS, not STABILITY_MS', async () => {
  const h = rig();
  h.engine.onLocalSpeechStart();
  await h.advance(2000);
  h.engine.onLocalSpeechEndBeforeFinal();      // speech ended; upload in flight
  await h.advance(600);                         // the REST round trip
  const finalAt = h.clock.now();
  h.final(Q);
  await h.advance(STABILITY_MS + 1000);
  assert.equal(h.state.dispatchedAt.length, 1);
  const wait = h.state.dispatchedAt[0].at - finalAt;
  assert.ok(wait < STABILITY_MS, `dispatched ${wait} ms after the final (was held to ${STABILITY_MS})`);
});

test('the stop alone commits nothing: earlier finals are not judged without the last words', async () => {
  const h = rig();
  h.engine.onLocalSpeechStart();
  h.final('So I have been looking at your background.');
  await h.advance(300);                         // they keep talking
  h.engine.onLocalSpeechEndBeforeFinal();
  await h.advance(ENDPOINT_CONFIRM_MS + 100);   // the second final is still uploading
  assert.equal(h.state.dispatchedAt.length, 0, 'nothing dispatched on the stop alone');
  // The stop did not shorten anything for the finals already in hand.
  const judgedBefore = h.state.judged.length;
  h.final(Q);
  await h.advance(ENDPOINT_CONFIRM_MS + 600);
  assert.ok(h.state.dispatchedAt.length === 1 && h.state.dispatchedAt[0].text.endsWith(Q), 'the whole turn, last words included');
  assert.ok(h.state.judged.length > judgedBefore);
});

test('speech resuming before the final lands cancels the hint', async () => {
  const h = rig();
  h.engine.onLocalSpeechStart();
  h.engine.onLocalSpeechEndBeforeFinal();
  await h.advance(200);
  h.engine.onLocalSpeechStart();                // they started again
  const finalAt = h.clock.now();
  h.final(Q);
  await h.advance(STABILITY_MS + 1000);
  assert.equal(h.state.dispatchedAt.length, 1);
  assert.ok(h.state.dispatchedAt[0].at - finalAt >= STABILITY_MS, 'the full hold applies again');
});

test('without voice-detector speech starts the hint is not trusted (a resumption would be invisible)', async () => {
  const h = rig();
  h.engine.onLocalSpeechEndBeforeFinal();
  await h.advance(600);
  const finalAt = h.clock.now();
  h.final(Q);
  await h.advance(STABILITY_MS + 1000);
  assert.ok(h.state.dispatchedAt[0].at - finalAt >= STABILITY_MS);
});

test('main.ts routes REST providers to the stop-before-final hint and streaming ones to the plain hint', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/main.ts'), 'utf8');
  const at = src.indexOf("capture.on('speech_ended'");
  assert.ok(at > 0);
  const block = src.slice(at, at + 4000);
  assert.match(block, /acceptsLocalSpeechEndHint\(provider\)[\s\S]{0,200}onLocalSpeechEnd\(\)/);
  assert.match(block, /onLocalSpeechEndBeforeFinal\(\)/);
});
