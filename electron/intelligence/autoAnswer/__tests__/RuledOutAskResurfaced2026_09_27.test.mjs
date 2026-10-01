// A question already ruled NOT an ask must not be answered because someone
// replied to it.
//
// Live 2026-09-27 (team meet, user name known): "Raj, can you make sure support
// knows about the Thursday cutover?" was judged silent (a request to a
// teammate). Raj's "Yes, I'll post in their channel today." then arrived, the
// merged candidate went to the judge again, and the judge answered the Raj
// request (question_text = that line). The request came from finals already
// ruled out, none of it from the new speech.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SimpleAutoAnswerEngine } = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/SimpleAutoAnswer.js'));

const flush = () => new Promise((r) => setImmediate(r));
const verdict = (over) => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.9, question_text: null, ...over });
const SILENT = verdict({ is_ask: false, directed_at_user: false, act: 'statement', action: 'silent', answerability: 0.1 });
const INCOMPLETE = verdict({ is_ask: false, complete: false, act: 'incomplete', action: 'silent', answerability: 0.1 });

function rig(replies) {
  const clock = new FakeClock();
  const state = { dispatched: [], skipped: [] };
  let n = 0;
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [], dispatch: (q) => { state.dispatched.push(q.text); },
    judgeCandidate: async () => replies[n++] ?? SILENT,
    telemetry: (e) => { if (e.name === 'auto_answer_ignored') state.skipped.push(e.skipReason); },
    log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  // `ms` of quiet after the final: 4 s is past every commit window; a short
  // gap is a speaker still mid-sentence.
  const say = async (text, ms = 4000) => {
    engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
    for (let t = 0; t < ms; t += 20) { clock.advance(20); await flush(); }
  };
  return { state, say };
}

test('a request ruled to a teammate stays silent when the teammate replies', async () => {
  const raj = 'Raj, can you make sure support knows about the Thursday cutover?';
  const h = rig([SILENT, verdict({ question_text: raj })]);
  await h.say(raj);
  await h.say("Yes, I'll post in their channel today.");
  assert.deepEqual(h.state.dispatched, [], 'the resurfaced request is not answered');
  assert.ok(h.state.skipped.includes('already_ruled_out'), 'and the skip says why');
});

test('a NEW question after a ruled-out remark is still answered', async () => {
  const ask = "What's the time complexity of your remove operation?";
  const h = rig([SILENT, verdict({ question_text: ask })]);
  await h.say('Take your time with this one, there is no rush at all.');
  await h.say(ask);
  assert.deepEqual(h.state.dispatched, [ask]);
});

test('an incomplete ask finished by later speech is still answered (incomplete is never ruled out)', async () => {
  const whole = 'And what I want you to do is design a rate limiter for our public API.';
  const h = rig([INCOMPLETE, verdict({ question_text: whole })]);
  await h.say('And what I want you to do is', 300);
  await h.say('design a rate limiter for our public API.');
  assert.equal(h.state.dispatched.length, 1);
  assert.match(h.state.dispatched[0], /rate limiter/);
});
