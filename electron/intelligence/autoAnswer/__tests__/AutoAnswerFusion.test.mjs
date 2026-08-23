/**
 * Endpoint fusion, TurnPredictor and Smart Turn (V3 Amendments 2 and 3).
 *
 * Mutation probes (docs/autopilot/auto-answer-v3-progress.md, Phase 5):
 *   fusion priority   → 'fusion priority: a provider endpoint beats the local predictor, which beats the window'
 *   budget boundaries → 'adaptive budget boundaries'
 *   hard cap          → 'hard cap under continuous finals with a confident endpoint'
 *   rhetorical hold   → 'rhetorical hold: an interviewer resume inside the hold cancels the dispatch'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from './fakeClock.mjs';
import {
  makeHarness, TurnManager, Predictor, QUIET, HARD_CAP_MS, USER_SILENCE_MS, RHETORICAL_HOLD_MS,
  CONFIRM_HIGH_MS, CONFIRM_MID_MS, CONFIDENT_ENDPOINT_P, LIKELY_ENDPOINT_P, POSSIBLE_ENDPOINT_P, confirmBudgetMs,
} from './harness.mjs';

const { AutoAnswerTurnManager } = TurnManager;
const {
  SmartTurnPredictor, PcmRingBuffer, bytesToPcm16k, normalizeWaveform, PREDICTION_TTL_MS, SMART_TURN_RING_SAMPLES,
} = Predictor;

function makeTurns() {
  const clock = new FakeClock();
  const commits = [];
  const tm = new AutoAnswerTurnManager({ onCommit: (c) => commits.push(c) }, clock, 'balanced');
  const final = (text) => tm.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now() }, 1);
  return { clock, tm, commits, final };
}

// ── budgets ───────────────────────────────────────────────────────────────

test('adaptive budget boundaries', () => {
  assert.equal(confirmBudgetMs(CONFIDENT_ENDPOINT_P, 'balanced'), CONFIRM_HIGH_MS);
  assert.equal(confirmBudgetMs(0.95, 'balanced'), CONFIRM_HIGH_MS);
  assert.equal(confirmBudgetMs(CONFIDENT_ENDPOINT_P - 0.001, 'balanced'), CONFIRM_MID_MS);
  assert.equal(confirmBudgetMs(LIKELY_ENDPOINT_P, 'balanced'), CONFIRM_MID_MS);
  assert.equal(confirmBudgetMs(LIKELY_ENDPOINT_P - 0.001, 'balanced'), QUIET);
  assert.equal(confirmBudgetMs(POSSIBLE_ENDPOINT_P, 'fast'), TurnManager.QUIET_WINDOW_MS.fast);
  assert.equal(confirmBudgetMs(POSSIBLE_ENDPOINT_P - 0.001, 'balanced'), null, 'below POSSIBLE → hold');
  assert.equal(CONFIRM_HIGH_MS, 250); assert.equal(CONFIRM_MID_MS, 600); assert.equal(HARD_CAP_MS, 2500);
});

test('fusion priority: a provider endpoint beats the local predictor, which beats the window', () => {
  // Window alone: QUIET.
  const w = makeTurns();
  w.final('Why did you choose Kafka?');
  w.clock.advance(QUIET - 1); assert.equal(w.commits.length, 0);
  w.clock.advance(1); assert.equal(w.commits.length, 1);
  assert.equal(w.commits[0].endpointSource, 'quiet_window');

  // Local predictor (0.95) shortens the window to CONFIRM_HIGH_MS.
  const l = makeTurns();
  l.final('Why did you choose Kafka?');
  l.clock.advance(100);
  l.tm.onLocalPrediction(0.95);
  l.clock.advance(CONFIRM_HIGH_MS - 1); assert.equal(l.commits.length, 0);
  l.clock.advance(1); assert.equal(l.commits.length, 1);
  assert.equal(l.commits[0].endpointSource, 'semantic');

  // Provider (0.75 → MID) arriving AFTER a confident local prediction still wins: provider tier overrides.
  const p = makeTurns();
  p.final('Why did you choose Kafka?');
  p.tm.onLocalPrediction(0.95);                          // would commit at +250
  p.clock.advance(100);
  p.tm.onProviderEndpoint({ type: 'speech_final', timestamp: p.clock.now(), confidence: 0.75 });  // +600 from now
  p.clock.advance(CONFIRM_HIGH_MS);                      // +350: the local deadline is gone
  assert.equal(p.commits.length, 0, 'provider tier replaced the local deadline');
  p.clock.advance(CONFIRM_MID_MS - CONFIRM_HIGH_MS);     // +700
  assert.equal(p.commits.length, 1);
  assert.equal(p.commits[0].endpointSource, 'speech_final');

  // A local prediction arriving after a provider deadline does NOT override it.
  const q = makeTurns();
  q.final('Why did you choose Kafka?');
  q.tm.onProviderEndpoint({ type: 'utterance_end', timestamp: q.clock.now(), confidence: 0.72 }); // MID
  q.tm.onLocalPrediction(0.99);                                                                    // would be HIGH
  q.clock.advance(CONFIRM_HIGH_MS); assert.equal(q.commits.length, 0, 'local cannot shorten a provider deadline');
  q.clock.advance(CONFIRM_MID_MS - CONFIRM_HIGH_MS); assert.equal(q.commits.length, 1);
});

test('a low-confidence endpoint holds: the quiet window stands, never extended, never shortened', () => {
  const t = makeTurns();
  t.final('Why did you choose Kafka?');
  t.clock.advance(100);
  t.tm.onProviderEndpoint({ type: 'speech_final', timestamp: t.clock.now(), confidence: 0.3 });
  t.clock.advance(QUIET - 101); assert.equal(t.commits.length, 0);
  t.clock.advance(1); assert.equal(t.commits.length, 1, 'the window committed on schedule');
});

test('new interviewer evidence after an endpoint resets to the window tier (TurnResumed)', () => {
  const t = makeTurns();
  t.final('Why did you choose Kafka');
  t.tm.onProviderEndpoint({ type: 'speech_final', timestamp: t.clock.now(), confidence: 0.95 }); // +250
  t.clock.advance(100);
  t.final('and would you again?');              // resumed
  t.clock.advance(CONFIRM_HIGH_MS); assert.equal(t.commits.length, 0, 'the confident deadline was wiped by the resume');
  t.clock.advance(QUIET - CONFIRM_HIGH_MS); assert.equal(t.commits.length, 1);
  assert.equal(t.commits[0].text, 'Why did you choose Kafka and would you again?');
});

test('hard cap under continuous finals with a confident endpoint', () => {
  const t = makeTurns();
  const t0 = t.clock.now();
  for (let i = 0; i < 20 && t.commits.length === 0; i++) {
    t.final('w' + i);
    t.tm.onProviderEndpoint({ type: 'speech_final', timestamp: t.clock.now(), confidence: 0.95 });
    t.clock.advance(200);                       // finals every 200 ms < CONFIRM_HIGH_MS: each resume wipes the deadline
  }
  assert.equal(t.commits.length, 1);
  const elapsed = t.clock.now() - t0;
  assert.ok(elapsed >= HARD_CAP_MS && elapsed < HARD_CAP_MS + 200, `committed at +${elapsed}`);
});

test('predictor-absent fallback: without a TurnPredictor the controller behaves exactly as on the deterministic path', async () => {
  const h = makeHarness({}, { turnPredictor: null });
  h.edge('interviewer', true); await h.advance(800); h.edge('interviewer', false);
  h.interviewerFinal('Why did you choose PostgreSQL?');
  await h.advance(QUIET);
  assert.deepEqual(h.texts(), ['Why did you choose PostgreSQL?']);
});

test('a sync TurnPredictor returning null leaves the window untouched; a confident one shortens it', async () => {
  const nullPredictor = { predict: () => null };
  const h = makeHarness({}, { turnPredictor: nullPredictor });
  h.edge('interviewer', true); await h.advance(800);
  h.interviewerFinal('Why did you choose PostgreSQL?');
  h.edge('interviewer', false);
  await h.advance(QUIET - 1); assert.deepEqual(h.texts(), []);
  await h.advance(1); assert.equal(h.texts().length, 1);

  const confident = { predict: () => ({ pEndpoint: 0.97, pContinuation: 0.03, pQuestionComplete: 0.97 }) };
  const g = makeHarness({}, { turnPredictor: confident });
  g.edge('interviewer', true); await g.advance(800);
  g.interviewerFinal('Why did you choose PostgreSQL?');
  g.edge('interviewer', false);                 // consultPredictor → onLocalPrediction(0.97) → commit at +250
  // Commit at +250; then user-silence (700 from the VAD end) and the rhetorical hold (600 from the last evidence) gate the dispatch.
  await g.advance(USER_SILENCE_MS - 1); assert.deepEqual(g.texts(), []);
  await g.advance(1); assert.equal(g.texts().length, 1, 'dispatched at USER_SILENCE_MS after the interviewer stopped — well inside the 1100 ms window');
});

test('rhetorical hold: an interviewer resume inside the hold cancels the dispatch', async () => {
  const confident = { predict: () => ({ pEndpoint: 0.97, pContinuation: 0.03, pQuestionComplete: 0.97 }) };
  const h = makeHarness({}, { turnPredictor: confident, channelTuning: { userSilenceMs: 0 } });
  h.edge('interviewer', true); await h.advance(800);
  h.interviewerFinal('Why do we shard by user id?');
  h.edge('interviewer', false);
  await h.advance(CONFIRM_HIGH_MS);             // committed; rhetorical hold until +600 from the final
  assert.deepEqual(h.texts(), []);
  assert.equal(h.controller.isHolding(), true);
  h.edge('interviewer', true);                  // "…Because hot keys."
  assert.ok(h.state.skips.includes('rhetorical'), h.state.skips.join(','));
  h.interviewerFinal('Because hot keys.');
  h.edge('interviewer', false);
  await h.advance(HARD_CAP_MS + QUIET);
  assert.deepEqual(h.texts(), [], 'the self-answered question never dispatches');
});

test('rhetorical hold: with no resume the dispatch lands at RHETORICAL_HOLD_MS after the last evidence', async () => {
  const confident = { predict: () => ({ pEndpoint: 0.97, pContinuation: 0.03, pQuestionComplete: 0.97 }) };
  const h = makeHarness({}, { turnPredictor: confident, channelTuning: { userSilenceMs: 0 } });
  h.edge('interviewer', true); await h.advance(800);
  h.interviewerFinal('Why did you choose PostgreSQL?');
  h.edge('interviewer', false);
  await h.advance(RHETORICAL_HOLD_MS - 1); assert.deepEqual(h.texts(), []);
  await h.advance(1); assert.equal(h.texts().length, 1);
});

// ── ring buffer / PCM ─────────────────────────────────────────────────────

test('PcmRingBuffer keeps the newest `capacity` samples in order', () => {
  const r = new PcmRingBuffer(8);
  r.push(new Int16Array([1, 2, 3]));
  assert.deepEqual(Array.from(r.snapshot()).map(x => Math.round(x * 32768)), [1, 2, 3]);
  r.push(new Int16Array([4, 5, 6, 7, 8, 9, 10]));       // wraps
  assert.equal(r.length(), 8);
  assert.deepEqual(Array.from(r.snapshot()).map(x => Math.round(x * 32768)), [3, 4, 5, 6, 7, 8, 9, 10]);
  r.push(new Int16Array(20).fill(7));                    // longer than capacity
  assert.deepEqual(Array.from(r.snapshot()).map(x => Math.round(x * 32768)), Array(8).fill(7));
  r.clear(); assert.equal(r.length(), 0);
  assert.equal(SMART_TURN_RING_SAMPLES, 16000 * 8, '8 s at 16 kHz = 256 KB of int16');
});

test('bytesToPcm16k decodes int16 LE and decimates 48 kHz by averaging', () => {
  const buf = Buffer.alloc(12);
  [100, 200, 300, -100, -200, -300].forEach((v, i) => buf.writeInt16LE(v, i * 2));
  assert.deepEqual(Array.from(bytesToPcm16k(buf, 16000)), [100, 200, 300, -100, -200, -300]);
  assert.deepEqual(Array.from(bytesToPcm16k(buf, 48000)), [200, -200]);
});

test('normalizeWaveform is zero-mean unit-variance', () => {
  const x = normalizeWaveform(new Float32Array([1, 2, 3, 4, 5, 6]));
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const v = x.reduce((a, b) => a + b * b, 0) / x.length;
  assert.ok(Math.abs(mean) < 1e-6 && Math.abs(v - 1) < 1e-3);
});

// ── Smart Turn adapter against a stub session ─────────────────────────────

function makeSmartTurn({ asset = '/models/smart-turn.onnx', p = 0.93, failSession = false, log = [] } = {}) {
  const clock = { t: 1_000_000 };
  const calls = { sessions: 0, runs: 0, features: [] };
  const predictor = new SmartTurnPredictor({
    log: (l) => log.push(l),
    now: () => clock.t,
    resolveAssetPath: () => asset,
    createSession: async () => {
      calls.sessions++;
      if (failSession) throw new Error('boom');
      return { run: async (f) => { calls.runs++; return p; } };
    },
    extractFeatures: async (w) => { calls.features.push(w.length); return { data: new Float32Array(80 * 800), dims: [1, 80, 800] }; },
  });
  return { predictor, calls, clock, log };
}

const flush = () => new Promise((r) => setImmediate(r));

test('SmartTurnPredictor: one inference per speech stop, subscribers notified, predict() answers until TTL', async () => {
  const s = makeSmartTurn({ p: 0.93 });
  const seen = [];
  s.predictor.subscribe((pr, at) => seen.push([pr.pEndpoint, at]));
  s.predictor.pushPcm(Buffer.alloc(16000 * 2), 16000);   // 1 s of silence-valued audio
  s.predictor.onInterviewerSpeechStop(s.clock.t);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(s.calls.sessions, 1); assert.equal(s.calls.runs, 1);
  assert.deepEqual(seen, [[0.93, s.clock.t]]);
  assert.equal(s.predictor.isAvailable(), true);
  const pr = s.predictor.predict({ partialTranscript: '', recentTranscript: [], speechDurationMs: 1000, silenceMs: 0 });
  assert.equal(pr.pEndpoint, 0.93); assert.ok(Math.abs(pr.pContinuation - 0.07) < 1e-9);
  s.clock.t += PREDICTION_TTL_MS + 1;
  assert.equal(s.predictor.predict({ partialTranscript: '', recentTranscript: [], speechDurationMs: 0, silenceMs: 0 }), null, 'stale');
  // A second stop reuses the session.
  s.predictor.onInterviewerSpeechStop(s.clock.t);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(s.calls.sessions, 1); assert.equal(s.calls.runs, 2);
});

test('SmartTurnPredictor: missing asset → predict() null, logged ONCE, deterministic path unaffected', async () => {
  const s = makeSmartTurn({ asset: null });
  s.predictor.pushPcm(Buffer.alloc(16000 * 2), 16000);
  s.predictor.onInterviewerSpeechStop(s.clock.t);
  s.predictor.onInterviewerSpeechStop(s.clock.t + 10);
  for (let i = 0; i < 5; i++) await flush();
  s.predictor.onInterviewerSpeechStop(s.clock.t + 20);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(s.predictor.predict({ partialTranscript: '', recentTranscript: [], speechDurationMs: 0, silenceMs: 0 }), null);
  assert.equal(s.log.filter(l => l.includes('asset not found')).length, 1, 'logged once');
  assert.equal(s.calls.runs, 0);

  // Wired into the controller, nothing changes on the deterministic path.
  const h = makeHarness({}, { turnPredictor: s.predictor });
  h.edge('interviewer', true); await h.advance(800);
  h.interviewerFinal('Why did you choose PostgreSQL?');
  h.edge('interviewer', false);
  await h.advance(QUIET - 1); assert.deepEqual(h.texts(), []);
  await h.advance(1); assert.equal(h.texts().length, 1);
});

test('SmartTurnPredictor: a session that fails to load degrades to null and never throws', async () => {
  const s = makeSmartTurn({ failSession: true });
  s.predictor.pushPcm(Buffer.alloc(16000 * 2), 16000);
  s.predictor.onInterviewerSpeechStop(s.clock.t);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(s.predictor.isAvailable(), false);
  assert.equal(s.predictor.predict({ partialTranscript: '', recentTranscript: [], speechDurationMs: 0, silenceMs: 0 }), null);
  assert.ok(s.log.some(l => l.includes('failed to load')));
});

test('SmartTurnPredictor: too little audio (< 250 ms) is not judged; 8 s window is what the frontend sees', async () => {
  const s = makeSmartTurn();
  s.predictor.pushPcm(Buffer.alloc(1000 * 2), 16000);     // 62 ms
  s.predictor.onInterviewerSpeechStop(s.clock.t);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(s.calls.runs, 0);
  s.predictor.pushPcm(Buffer.alloc(16000 * 2 * 12), 16000); // 12 s → only the last 8 s survive
  s.predictor.onInterviewerSpeechStop(s.clock.t);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(s.calls.runs, 1);
  assert.equal(s.calls.features.at(-1), SMART_TURN_RING_SAMPLES);
});

test('controller: an async predictor feeds the fusion tier-2 through subscribe()', async () => {
  const s = makeSmartTurn({ p: 0.97 });
  const h = makeHarness({}, { turnPredictor: s.predictor, channelTuning: { userSilenceMs: 0 } });
  s.predictor.pushPcm(Buffer.alloc(16000 * 2), 16000);
  h.edge('interviewer', true); await h.advance(800);
  h.interviewerFinal('Why did you choose PostgreSQL?');
  h.edge('interviewer', false);                 // → onInterviewerSpeechStop → (async) prediction 0.97 → CONFIRM_HIGH
  for (let i = 0; i < 6; i++) await h.flush();
  await h.advance(RHETORICAL_HOLD_MS);          // commit at +250, rhetorical hold to +600
  assert.equal(h.texts().length, 1);
  assert.equal(h.state.dispatched[0].question.endpointSource, 'semantic');
});
