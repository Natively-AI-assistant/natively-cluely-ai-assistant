/**
 * Back-to-back asks (pipeline forensics 2026-11-13, F-CTX-04). The second ask
 * starts ~0.65 s after the first final, before the first verdict lands, so
 * that verdict is superseded and the two merge into one candidate. Owner
 * decision: ONE combined answer, but the dispatched question must keep BOTH
 * asks. A judge whose question_text keeps only the last ask used to drop the
 * first one from the dispatch.
 *
 * Guards (the other direction): a lead-in such as "Can you hear me?" is never
 * glued on; neither is an ask a verdict already ruled on, a statement, or an
 * ask that came long before the second one.
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
const verdict = (o) => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null, action: 'answer', ...o });
const NO = JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0.1, question_text: null, action: 'silent' });

function rig(judge) {
  const clock = new FakeClock();
  const state = { dispatched: [], judged: [] };
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [],
    dispatch: (q) => { state.dispatched.push(q.text); },
    // A real call takes ~1 s and stops when the controller aborts it.
    judgeCandidate: (req, signal) => {
      state.judged.push(req.candidateText);
      const n = state.judged.length;
      return new Promise((resolve) => {
        const t = clock.setTimeout(() => resolve(judge(req, n)), 1000);
        signal?.addEventListener('abort', () => { clock.clearTimeout(t); resolve(null); });
      });
    },
    telemetry: () => {}, log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const final = (text) => engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
  const interim = (text) => engine.ingest({ speaker: 'interviewer', text, final: false, timestamp: clock.now(), origin: 'stt' });
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(50, left); clock.advance(s); left -= s; await flush(); await flush(); } };
  return { engine, state, final, interim, advance };
}

const Q1 = 'What is the difference between a process and a thread?';
const Q2 = 'And how does a mutex differ from a semaphore?';

/** u0 final, u1 starts `gap` ms later (interims), u1 final 900 ms after that. */
async function backToBack(h, first, second, gap = 650) {
  h.final(first);
  await h.advance(gap);
  h.interim('And how does');
  await h.advance(450);
  h.interim('And how does a mutex differ');
  await h.advance(450);
  h.final(second);
  await h.advance(STABILITY_MS + 2500);
}

test('two asks under a second apart: one answer whose question keeps BOTH asks, in order', async () => {
  const h = rig((req) => (req.candidateText.includes(Q1) && req.candidateText.includes(Q2) ? verdict({ question_text: Q2 }) : verdict({ question_text: Q1 })));
  await backToBack(h, Q1, Q2);
  assert.equal(h.state.dispatched.length, 1, 'one combined answer');
  const text = h.state.dispatched[0];
  assert.ok(text.includes(Q1) && text.includes(Q2), `both asks are in the question: "${text}"`);
  assert.ok(text.indexOf(Q1) < text.indexOf(Q2), 'in the order they were asked');
});

test('a judge question_text that already keeps both is dispatched unchanged', async () => {
  const both = `${Q1} ${Q2}`;
  const h = rig(() => verdict({ question_text: both }));
  await backToBack(h, Q1, Q2);
  assert.deepEqual(h.state.dispatched, [both]);
});

test('a logistics lead-in ("Can you hear me okay?") is never glued onto the real ask', async () => {
  const lead = 'Can you hear me okay?';
  const h = rig(() => verdict({ question_text: Q2 }));
  await backToBack(h, lead, Q2);
  assert.deepEqual(h.state.dispatched, [Q2]);
});

test('a statement before the ask is not glued on', async () => {
  const lead = 'So we run everything on Kubernetes these days.';
  const h = rig(() => verdict({ question_text: Q2 }));
  await backToBack(h, lead, Q2);
  assert.deepEqual(h.state.dispatched, [Q2]);
});

test('an earlier ask a verdict already ruled on is not glued on', async () => {
  // u0 gets its own verdict (silent: say, addressed to a teammate), then u1 arrives later.
  const h = rig((req, n) => (n === 1 ? NO : verdict({ question_text: Q2 })));
  h.final(Q1);
  await h.advance(STABILITY_MS + 2000);
  h.final(Q2);
  await h.advance(STABILITY_MS + 2500);
  assert.deepEqual(h.state.dispatched, [Q2]);
});

test('an earlier ask that came well before the second one is not glued on', async () => {
  // The first verdict says "unfinished" (so it stays unjudged), and the
  // second ask starts 4 s later: a separate thought, not a two-part ask.
  const h = rig((req, n) => (n === 1 ? verdict({ complete: false, act: 'incomplete', action: 'silent' }) : verdict({ question_text: Q2 })));
  h.final(Q1);
  await h.advance(4000);
  h.final(Q2);
  await h.advance(STABILITY_MS + 2500);
  assert.deepEqual(h.state.dispatched, [Q2]);
});
