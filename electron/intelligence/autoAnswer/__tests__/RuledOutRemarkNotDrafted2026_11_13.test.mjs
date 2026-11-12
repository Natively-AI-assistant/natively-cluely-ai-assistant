/**
 * A remark already ruled not an ask must not ride into the next question's
 * draft, its question line, or across a mode switch (pipeline forensics
 * 2026-11-13, F-CTX-03).
 *
 * Replayed: a greeting judged silent at 6.1 s was prefixed to the Orion
 * question at 13.8 s, after a mode switch. The dispatch text was clean (the
 * judge's question_text), but the prefetch had drafted on the 104-char merged
 * candidate and keyed reuse adopted that draft for the clean ask.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SimpleAutoAnswerEngine, STABILITY_MS } = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/SimpleAutoAnswer.js'));

const flush = () => new Promise((r) => setImmediate(r));
const GREETING = 'Morning everyone, thanks for joining, quick note that the deck is in the channel.';
const ASK = 'What does the Orion service do in the ingest path?';
const verdict = (o) => JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0.1, question_text: null, action: 'silent', ...o });
const NO = verdict({});
const YES = (question_text = null) => verdict({ is_ask: true, directed_at_user: true, act: 'question', answerability: 0.95, question_text, action: 'answer' });

function rig(judge, { snapshot } = {}) {
  const clock = new FakeClock();
  const state = { dispatched: [], prefetched: [], judged: [] };
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q, opts) => { state.dispatched.push({ text: q.text, id: q.id, reuse: opts.reuseSpeculative }); },
    prefetchAnswer: (id, text) => { state.prefetched.push({ id, text }); },
    speculativeSnapshot: () => (snapshot ? snapshot(state) : { questionId: null, text: null }),
    judgeCandidate: (req) => { state.judged.push(req.candidateText); return judge(req, state.judged.length); },
    telemetry: () => {}, log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const say = (text) => engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(100, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { engine, state, say, advance };
}

test('the prefetch drafts on the unjudged ask, not on the ruled-out remark before it', async () => {
  const h = rig(async (_r, n) => (n === 1 ? NO : YES(ASK)));
  h.say(GREETING);
  await h.advance(STABILITY_MS + 2000);
  h.say(ASK);
  await h.advance(STABILITY_MS + 2000);
  assert.ok(h.state.judged[1].includes(GREETING), 'the judge still sees the remark as context');
  const draft = h.state.prefetched.at(-1);
  assert.equal(draft.text, ASK, 'the draft is for the ask alone');
});

test('a "whole candidate" verdict dispatches the unjudged ask, not the merged text', async () => {
  const h = rig(async (_r, n) => (n === 1 ? NO : YES(null)));
  h.say(GREETING);
  await h.advance(STABILITY_MS + 2000);
  h.say(ASK);
  await h.advance(STABILITY_MS + 2000);
  assert.equal(h.state.dispatched.length, 1);
  assert.equal(h.state.dispatched[0].text, ASK);
});

test('a keyed draft written for other words is not adopted; one that holds the question is', async () => {
  // The engine's snapshot: same id, but drafted on the merged text that lacks
  // none of the question's words — adopted; drafted on a cut-short interim — not.
  let draftText = `${GREETING} ${ASK}`;
  const h = rig(async (_r, n) => (n === 1 ? NO : YES(ASK)), {
    snapshot: (s) => ({ questionId: s.prefetched.at(-1)?.id ?? null, text: draftText }),
  });
  h.say(GREETING);
  await h.advance(STABILITY_MS + 2000);
  h.say(ASK);
  await h.advance(STABILITY_MS + 2000);
  assert.equal(h.state.dispatched[0].reuse, true, 'a draft that holds every word of the ask is still adopted (no lost head start)');

  draftText = 'What does the Orion';
  const h2 = rig(async () => YES(ASK), { snapshot: (s) => ({ questionId: s.prefetched.at(-1)?.id ?? null, text: draftText }) });
  h2.say(ASK);
  await h2.advance(STABILITY_MS + 2000);
  assert.equal(h2.state.dispatched[0].reuse, false, 'a draft for a cut-short question is restarted on the whole question');
});

test('a mode switch drops speech held for the next ask', async () => {
  const h = rig(async (_r, n) => (n === 1 ? NO : YES(null)));
  h.say(GREETING);
  await h.advance(STABILITY_MS + 2000);
  h.engine.onModeChanged();
  h.say(ASK);
  await h.advance(STABILITY_MS + 2000);
  assert.ok(!h.state.judged[1].includes('Morning everyone'), 'the old mode\'s remark is not in the new mode\'s candidate');
  assert.equal(h.state.dispatched[0].text, ASK);
});

test('ids keep counting across a mode switch (no reuse of an earlier id)', async () => {
  const h = rig(async () => YES(null));
  h.say(ASK);
  await h.advance(STABILITY_MS + 2000);
  h.engine.onModeChanged();
  h.say('And how is it deployed across regions?');
  await h.advance(STABILITY_MS + 2000);
  assert.equal(h.state.dispatched.length, 2);
  assert.notEqual(h.state.dispatched[0].id, h.state.dispatched[1].id);
});
