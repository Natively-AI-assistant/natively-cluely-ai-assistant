/**
 * Transcript normalisation and duplicates must not change the question line
 * (pipeline forensics 2026-11-13, F-CTX-10):
 *  - P2-s16h: the STT delivered the same final twice and the dispatched
 *    question carried the question twice;
 *  - REST1-s02: "Which one would you use…" reached every answer prompt as
 *    "Which 1 would you use…" (canonicalizeSttSpellings read the sentence's
 *    capital W as an identifier head).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../../dist-electron/electron');
const { SimpleAutoAnswerEngine, STABILITY_MS } = require(path.join(root, 'intelligence/autoAnswer/SimpleAutoAnswer.js'));
const { canonicalizeSttSpellings, stripSttFillers } = require(path.join(root, 'context-intelligence/question/turn-classifier.js'));

const flush = () => new Promise((r) => setImmediate(r));
const YES = JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null, action: 'answer' });

function rig() {
  const clock = new FakeClock();
  const state = { dispatched: [], judged: [] };
  const engine = new SimpleAutoAnswerEngine({
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q) => { state.dispatched.push(q.text); },
    judgeCandidate: async (req) => { state.judged.push(req.candidateText); return YES; },
    telemetry: () => {}, log: () => {},
  }, clock);
  engine.onMeetingStart();
  const final = (text) => engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(100, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { state, final, advance };
}

test('a duplicated final is one utterance: the question is not repeated', async () => {
  const h = rig();
  const q = 'How would you detect one in production?';
  h.final(q);
  h.final(q);                              // the STT sent the same final again
  await h.advance(STABILITY_MS + 1500);
  assert.deepEqual(h.state.dispatched, [q]);
  assert.ok(h.state.judged.every((c) => c === q), 'the judge saw it once too');
});

test('the same words said again later, after other speech, are kept', async () => {
  const h = rig();
  h.final('Why?');
  h.final('I mean, why not use a queue there?');
  h.final('Why?');
  await h.advance(STABILITY_MS + 1500);
  assert.equal(h.state.dispatched[0], 'Why? I mean, why not use a queue there? Why?');
});

test('"Which one" keeps the word one in the question line', () => {
  assert.equal(stripSttFillers('Which one would you use for a connection pool?'), 'Which one would you use for a connection pool?');
  assert.equal(canonicalizeSttSpellings('Which one would you pick?'), 'Which one would you pick?');
  assert.equal(canonicalizeSttSpellings('Pick one and tell me why.'), 'Pick one and tell me why.');
});

test('spoken identifiers are still canonicalised', () => {
  assert.equal(canonicalizeSttSpellings('ARCH one oh four, do you remember'), 'ARCH 104, do you remember');
  assert.equal(canonicalizeSttSpellings('What caused incident forty-four seventy-one?'), 'What caused incident 4471?');
  assert.equal(canonicalizeSttSpellings('question three on the sheet'), 'question 3 on the sheet');
  assert.equal(canonicalizeSttSpellings('Look at DEBUG two please'), 'Look at DEBUG 2 please');
});
