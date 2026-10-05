// The STT stall cap: a frozen interim stands in for a final that never comes.
//
// Live 2026-09-26/27: the interviewer stopped, "…with Z" sat on screen as an
// interim, and the final landed 3.5, 8.7 and 12 s later with no new speech.
// Nothing was judged until it did. Now, STALL_PROMOTE_MS after the voice
// detector's stop with the interim frozen, the interim is judged as if it were
// the final (the judge told the last word may be clipped). When the real final
// arrives it takes the stand-in's place: never a second judge call on the same
// words, never a second answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DIST = path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer');
const { SimpleAutoAnswerEngine, STALL_PROMOTE_MS, isSameUtterance } = require(path.join(DIST, 'SimpleAutoAnswer.js'));
const { buildJudgePrompt } = require(path.join(DIST, 'AutoAnswerJudge.js'));

const flush = () => new Promise((r) => setImmediate(r));
const verdict = (over) => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.9, question_text: null, ...over });
const INCOMPLETE = verdict({ is_ask: false, complete: false, act: 'incomplete', action: 'silent', answerability: 0.1 });

/** The real engine. Each judge reply may carry a delay (ms on the fake clock). */
function rig(replies = [], { judgeMs = 0 } = {}) {
  const clock = new FakeClock();
  const s = { judged: [], dispatched: [], events: [] };
  let n = 0;
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q) => { s.dispatched.push(q.text); },
    judgeCandidate: (req) => {
      s.judged.push(req);
      const r = replies[n++] ?? verdict();
      const [raw, ms] = Array.isArray(r) ? r : [r, judgeMs];
      return ms > 0 ? new Promise((res) => clock.setTimeout(() => res(raw), ms)) : Promise.resolve(raw);
    },
    telemetry: (e) => s.events.push(e),
    log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const seg = (text, final) => engine.ingest({ speaker: 'interviewer', text, final, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
  const wait = async (ms) => { for (let t = 0; t < ms; t += 20) { clock.advance(20); await flush(); } };
  return {
    s, engine, clock, wait,
    interim: (t) => seg(t, false),
    final: (t) => seg(t, true),
    stop: () => engine.onLocalSpeechEnd(),
    start: () => engine.onLocalSpeechStart(),
    candidates: () => s.events.filter((e) => e.name === 'auto_answer_candidate'),
  };
}

const ASK = 'Why not just restart the whole cluster on a smaller node?';
const CLIPPED = 'Why not just restart the whole cluster on a s';

test('the normal path is unchanged: a final inside the cap gives the same judging, no lagging flag', async () => {
  const run = async (withStop) => {
    const h = rig();
    h.interim('Why not just restart the whole cluster on a');
    if (withStop) h.stop();
    await h.wait(800);
    h.final(ASK);
    await h.wait(4000);
    return h;
  };
  const withStop = await run(true);
  const without = await run(false);
  assert.equal(withStop.s.judged.length, 1);
  assert.equal(withStop.s.judged[0].transcriptLagging, undefined, 'the prompt is byte-identical on a normal turn');
  assert.deepEqual(withStop.s.dispatched, [ASK]);
  assert.equal(withStop.candidates()[0].endpointSource, 'quiet_window');
  // Same sequence with and without the voice detector's stop.
  assert.deepEqual(withStop.s.events.map((e) => [e.name, e.judgeOutcome ?? e.action ?? e.skipReason ?? '']),
    without.s.events.map((e) => [e.name, e.judgeOutcome ?? e.action ?? e.skipReason ?? '']));
});

test('a stall: the frozen interim is judged at the cap, answered once, and its late final is not answered again', async () => {
  const h = rig();
  h.interim(CLIPPED);
  h.stop();
  await h.wait(STALL_PROMOTE_MS - 100);
  assert.equal(h.s.judged.length, 0, 'not before the cap');
  await h.wait(300);
  assert.equal(h.s.judged.length, 1, 'judged at the cap, not when the final lands');
  assert.equal(h.s.judged[0].transcriptLagging, true, 'the judge is told the last word may be clipped');
  assert.equal(h.candidates()[0].endpointSource, 'stt_stall');
  await h.wait(500);
  assert.deepEqual(h.s.dispatched, [CLIPPED]);

  h.stop();                     // another stop with the same interim still dangling
  await h.wait(STALL_PROMOTE_MS + 500);
  h.final(ASK);                 // the stalled final, 8 s late
  await h.wait(4000);
  assert.equal(h.s.judged.length, 1, 'one judge call for one utterance');
  assert.equal(h.s.dispatched.length, 1, 'one answer');
});

test('a slow final that lands while the stand-in is being judged replaces it without superseding the verdict', async () => {
  const h = rig([[verdict(), 1500]]);
  h.interim(CLIPPED);
  h.stop();
  await h.wait(STALL_PROMOTE_MS + 100);          // promoted; the judge is out for 1.5 s
  h.final(ASK);
  await h.wait(3000);
  assert.equal(h.s.judged.length, 1);
  assert.equal(h.s.events.filter((e) => e.judgeOutcome === 'stale').length, 0, 'the final did not supersede the verdict');
  assert.equal(h.s.dispatched.length, 1);
});

test('no stop from the voice detector: no promotion (a slow transcriber mid-speech is not a stall)', async () => {
  const h = rig();
  h.interim(CLIPPED);
  await h.wait(10_000);
  assert.equal(h.s.judged.length, 0);
});

test('the speaker started again after the stop: no promotion', async () => {
  const h = rig();
  h.interim(CLIPPED);
  h.stop();
  await h.wait(500);
  h.start();
  await h.wait(10_000);
  assert.equal(h.s.judged.length, 0);
});

test('a final that says something else drops the stand-in and is judged on its own', async () => {
  const h = rig([INCOMPLETE, verdict()]);
  h.interim('Can you tell me about the time you led the');
  h.stop();
  await h.wait(STALL_PROMOTE_MS + 300);
  assert.equal(h.s.judged.length, 1);
  const other = 'Actually, a different one: how do you handle on-call burnout on your team?';
  h.final(other);
  await h.wait(4000);
  assert.equal(h.s.judged.length, 2);
  assert.equal(h.s.judged[1].transcriptLagging, undefined);
  assert.ok(!h.s.judged[1].candidateText.includes('led the'), 'the stand-in is gone from the candidate');
  assert.deepEqual(h.s.dispatched, [other]);
});

test('"unfinished" on the clipped words, with the real final already in: the real words are judged', async () => {
  const h = rig([[INCOMPLETE, 1200], verdict()]);
  h.interim(CLIPPED);
  h.stop();
  await h.wait(STALL_PROMOTE_MS + 100);
  h.final(ASK);                 // lands while the stand-in is judged
  await h.wait(4000);
  assert.equal(h.s.judged.length, 2, 're-judged on the real final');
  assert.equal(h.s.judged[1].transcriptLagging, undefined);
  assert.deepEqual(h.s.dispatched, [ASK]);
});

test('without speech-start edges, a stop from before this utterance never promotes it', async () => {
  const h = rig();
  h.stop();                     // an earlier pause
  await h.wait(1000);
  h.interim(CLIPPED);           // the interviewer is talking again; no start edge reached us
  await h.wait(10_000);
  assert.equal(h.s.judged.length, 0);
});

test('with speech-start edges, a stop BEFORE the lagging interims still counts (relay lag)', async () => {
  const h = rig();
  h.start();
  await h.wait(3000);
  h.stop();                     // the speaker finished…
  await h.wait(900);
  h.interim(CLIPPED);           // …and the transcriber catches up late, then freezes
  await h.wait(STALL_PROMOTE_MS + 300);
  assert.equal(h.s.judged.length, 1);
  assert.equal(h.s.judged[0].transcriptLagging, true);
});

test('isSameUtterance: the late final of a clipped interim, not new speech', () => {
  assert.equal(isSameUtterance(CLIPPED, ASK), true);
  assert.equal(isSameUtterance('How would you shard the orders table', 'How would you shard the orders table?'), true);
  assert.equal(isSameUtterance(CLIPPED, 'Why not just restart the whole cluster on a smaller node and then drain the old one first?'), false, 'many more words: new speech');
  assert.equal(isSameUtterance(CLIPPED, 'Okay, moving on to the next topic now.'), false);
});

test('the judge prompt carries the lagging note only when asked, byte-identical otherwise', () => {
  const req = { candidateText: CLIPPED, recentTurns: [], questionId: 'q' };
  const plain = buildJudgePrompt(req);
  assert.equal(buildJudgePrompt({ ...req, transcriptLagging: false }), plain);
  const lagging = buildJudgePrompt({ ...req, transcriptLagging: true });
  assert.notEqual(lagging, plain);
  assert.match(lagging, /speech-to-text has not caught up/);
  assert.ok(lagging.indexOf('speech-to-text has not caught up') > lagging.indexOf('</candidate>'), 'trailing, beside the candidate');
});
