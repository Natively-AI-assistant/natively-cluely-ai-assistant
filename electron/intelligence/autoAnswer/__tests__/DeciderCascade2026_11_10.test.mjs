/**
 * The decision layer's pure parts (campaign Phase 4): the backend contract and gate
 * (DecisionBackend.ts), platform choices (deciderPlatform.ts, both branches, injected platform),
 * and the cascade (AutoAnswerDecider.ts) on a fake clock.
 *
 * The properties that matter most:
 *   - shadow mode returns the LLM judge's reply UNCHANGED, whatever the decider thinks;
 *   - on mode never acts on a decision below its label's fitted confidence or on truncated input;
 *   - a decider verdict in judge format means the same thing to the engine's own parser/router;
 *   - telemetry carries no text.
 *
 * Mutation probes (progress log, Phase 4):
 *   shadow returns the decider's reply           → 'shadow: the judge's reply is returned unchanged…'
 *   gate ignores `truncated`                     → 'gateDecision…'
 *   gate uses > instead of >=                    → 'gateDecision…'
 *   doubt policy answers on a silent top choice  → 'on: escalated + judge failed…'
 *   deadline not applied to a backend            → 'on: a backend that misses its deadline…'
 *   win32 default EP dml                         → 'executionProvidersFor…'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/decider', f));
const DB = dist('DecisionBackend.js');
const P = dist('deciderPlatform.js');
const { AutoAnswerDecider, HOSTED_DEADLINE_MS, LOCAL_DEADLINE_MS } = dist('AutoAnswerDecider.js');
const { createAppDecider } = dist('appDecider.js');

const CANDIDATE = 'how would you shard the orders table when one region does most of the writes';
const req = (over = {}) => ({ candidateText: CANDIDATE, recentTurns: [], questionId: 'q1', modeName: null, ...over });
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

function decision(choice, conf, over = {}) {
  const probabilities = { answer: 0.1, silent: 0.1, wait: 0.1, [choice]: conf };
  return { choice, probabilities, answerConfidence: conf, entropyConfidence: 0.5, truncated: false, ms: 5, ...over };
}

/** A scripted backend. `reply` is a decision, an Error (rejects), 'hang' (never settles) or a function. */
function backend(kind, reply, { available = true } = {}) {
  const b = {
    kind, calls: 0, lastSignal: null,
    isAvailable: () => (typeof available === 'function' ? available() : available),
    decide(_r, signal) {
      b.calls++; b.lastSignal = signal;
      if (reply === 'hang') return new Promise(() => {});
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(typeof reply === 'function' ? reply() : reply);
    },
  };
  return b;
}

const JUDGE_ANSWER = JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.97, question_text: null });
const JUDGE_SILENT = JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', action: 'silent', answerability: 0.1, question_text: null });

function make({ mode = 'on', backends = [], judge, thresholds = { answer: 0.9, silent: 0.9, wait: 0.9 } } = {}) {
  const clock = new FakeClock();
  const events = [];
  const judgeCalls = [];
  const d = new AutoAnswerDecider({
    mode: () => mode,
    backends: () => backends,
    ...(judge === undefined ? {} : {
      llmJudge: (r, s) => { judgeCalls.push(r); return typeof judge === 'function' ? judge(r, s) : Promise.resolve(judge); },
    }),
    thresholds: () => thresholds,
    clock,
    telemetry: (e) => events.push(e),
  });
  return { d, clock, events, judgeCalls };
}

// ── platform ─────────────────────────────────────────────────────────────────────────────────

test('resolveDeciderMode: explicit values win; default shadow in dev, off when packaged', () => {
  assert.equal(P.resolveDeciderMode({}, false), 'shadow');
  assert.equal(P.resolveDeciderMode({}, true), 'off');
  assert.equal(P.resolveDeciderMode({ NATIVELY_AUTO_ANSWER_DECIDER: ' ON ' }, true), 'on');
  assert.equal(P.resolveDeciderMode({ NATIVELY_AUTO_ANSWER_DECIDER: 'off' }, false), 'off');
  assert.equal(P.resolveDeciderMode({ NATIVELY_AUTO_ANSWER_DECIDER: 'shadow' }, true), 'shadow');
  assert.equal(P.resolveDeciderMode({ NATIVELY_AUTO_ANSWER_DECIDER: 'yes' }, true), 'off', 'an unknown value is not a flip');
});

test('executionProvidersFor: darwin and win32 default to CPU, accelerators opt-in, others throw', () => {
  assert.deepEqual(P.executionProvidersFor('darwin'), ['cpu']);
  assert.deepEqual(P.executionProvidersFor('darwin', { NATIVELY_DECIDER_EP: 'coreml' }), ['coreml', 'cpu']);
  assert.deepEqual(P.executionProvidersFor('darwin', { NATIVELY_DECIDER_EP: 'dml' }), ['cpu'], 'DirectML is not a macOS provider');
  assert.deepEqual(P.executionProvidersFor('win32'), ['cpu']);
  assert.deepEqual(P.executionProvidersFor('win32', { NATIVELY_DECIDER_EP: 'dml' }), ['dml', 'cpu']);
  assert.deepEqual(P.executionProvidersFor('win32', { NATIVELY_DECIDER_EP: 'DirectML' }), ['dml', 'cpu']);
  assert.deepEqual(P.executionProvidersFor('win32', { NATIVELY_DECIDER_EP: 'coreml' }), ['cpu'], 'CoreML is not a Windows provider');
  assert.throws(() => P.executionProvidersFor('linux'), /Unsupported platform/);
  for (const p of ['darwin', 'win32']) {
    for (const ep of ['', 'coreml', 'dml']) {
      const list = P.executionProvidersFor(p, { NATIVELY_DECIDER_EP: ep });
      assert.equal(list.at(-1), 'cpu', `${p}/${ep}: CPU is always the last resort`);
    }
  }
});

test('ortExecutionProviders and deciderIntraOpThreads', () => {
  assert.deepEqual(P.ortExecutionProviders(['coreml', 'cpu']), [{ name: 'coreml', coreMlFlags: 0 }, 'cpu']);
  assert.deepEqual(P.ortExecutionProviders(['dml', 'cpu']), [{ name: 'dml' }, 'cpu']);
  assert.equal(P.deciderIntraOpThreads(10), 4);
  assert.equal(P.deciderIntraOpThreads(4), 2);
  assert.equal(P.deciderIntraOpThreads(1), 1);
  assert.equal(P.deciderIntraOpThreads(0), 1);
  assert.equal(P.deciderIntraOpThreads(10, { NATIVELY_DECIDER_THREADS: '6' }), 6);
  assert.equal(P.deciderIntraOpThreads(10, { NATIVELY_DECIDER_THREADS: 'x' }), 4);
});

// ── contract ─────────────────────────────────────────────────────────────────────────────────

test('gateDecision: at-or-above its label threshold decides; below, truncated or ESCALATE_ALL escalates', () => {
  const t = { answer: 0.9, silent: 0.8, wait: 0.95 };
  assert.deepEqual(DB.gateDecision(decision('answer', 0.9), t), { action: 'answer' });
  assert.deepEqual(DB.gateDecision(decision('answer', 0.8999), t), { action: 'escalate', escalateReason: 'below_threshold' });
  assert.deepEqual(DB.gateDecision(decision('silent', 0.8), t), { action: 'silent' });
  assert.deepEqual(DB.gateDecision(decision('wait', 0.94), t), { action: 'escalate', escalateReason: 'below_threshold' });
  assert.deepEqual(DB.gateDecision(decision('answer', 0.999, { truncated: true }), t), { action: 'escalate', escalateReason: 'truncated' });
  for (const c of ['answer', 'silent', 'wait']) {
    assert.equal(DB.gateDecision(decision(c, 1), DB.ESCALATE_ALL).action, 'escalate', `${c} under ESCALATE_ALL`);
  }
});

test('judgeReplyFor round-trips through the engine parser and router', () => {
  for (const label of ['answer', 'silent', 'wait']) {
    assert.equal(DB.labelOfJudgeReply(DB.judgeReplyFor(label), CANDIDATE), label, label);
  }
  assert.equal(DB.labelOfJudgeReply(JUDGE_ANSWER, CANDIDATE), 'answer');
  assert.equal(DB.labelOfJudgeReply(JUDGE_SILENT, CANDIDATE), 'silent');
  assert.equal(DB.labelOfJudgeReply('not json', CANDIDATE), null);
  assert.equal(DB.labelOfJudgeReply(null, CANDIDATE), null);
});

// ── cascade ──────────────────────────────────────────────────────────────────────────────────

test('off: the LLM judge alone; no backend is consulted and nothing is emitted', async () => {
  const b = backend('local', decision('silent', 0.99));
  const { d, events } = make({ mode: 'off', backends: [b], judge: JUDGE_ANSWER });
  assert.equal(await d.judge(req()), JUDGE_ANSWER);
  assert.equal(b.calls, 0);
  assert.equal(events.length, 0);
});

test("shadow: the judge's reply is returned unchanged, even against a confident decider", async () => {
  const b = backend('local', decision('silent', 0.999));
  const { d, events, judgeCalls } = make({ mode: 'shadow', backends: [b], judge: JUDGE_ANSWER });
  assert.equal(await d.judge(req()), JUDGE_ANSWER);
  assert.equal(judgeCalls.length, 1);
  await flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].decisionMode, 'shadow');
  assert.equal(events[0].decisionChoice, 'silent');
  assert.equal(events[0].judgeLabel, 'answer');
  assert.equal(events[0].shadowAgree, false);
});

test('shadow: a slow decider never delays the judge reply', async () => {
  const b = backend('local', 'hang');
  const { d, clock, events } = make({ mode: 'shadow', backends: [b], judge: JUDGE_SILENT });
  assert.equal(await d.judge(req()), JUDGE_SILENT, 'returned without advancing the clock');
  assert.equal(events.length, 0);
  clock.advance(LOCAL_DEADLINE_MS);
  await flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].escalateReason, 'backends_failed');
  assert.equal(events[0].shadowAgree, undefined, 'no decider choice, so no agreement claim');
});

test('shadow: with no backend available it is the judge alone, and nothing is emitted', async () => {
  const off = backend('local', decision('silent', 1), { available: false });
  const { d, events } = make({ mode: 'shadow', backends: [off], judge: JUDGE_ANSWER });
  assert.equal(await d.judge(req()), JUDGE_ANSWER);
  await flush();
  assert.equal(off.calls, 0);
  assert.equal(events.length, 0, 'no model downloaded is not an event per candidate');
});

test('on: a confident decision answers without calling the judge', async () => {
  const b = backend('hosted', decision('answer', 0.97));
  const { d, events, judgeCalls } = make({ backends: [b], judge: JUDGE_SILENT });
  const raw = await d.judge(req());
  assert.equal(DB.labelOfJudgeReply(raw, CANDIDATE), 'answer');
  assert.equal(judgeCalls.length, 0);
  assert.equal(events[0].decisionBackend, 'hosted');
  assert.equal(events[0].escalated, false);
});

test('on: below threshold escalates and the judge decides', async () => {
  const b = backend('local', decision('answer', 0.6));
  const { d, events, judgeCalls } = make({ backends: [b], judge: JUDGE_SILENT });
  assert.equal(await d.judge(req()), JUDGE_SILENT);
  assert.equal(judgeCalls.length, 1);
  assert.equal(events[0].escalateReason, 'below_threshold');
});

test('on: truncated input escalates even at confidence 1', async () => {
  const b = backend('local', decision('silent', 1, { truncated: true }));
  const { d, judgeCalls, events } = make({ backends: [b], judge: JUDGE_ANSWER });
  assert.equal(await d.judge(req()), JUDGE_ANSWER);
  assert.equal(judgeCalls.length, 1);
  assert.equal(events[0].escalateReason, 'truncated');
});

test('on: a backend that misses its deadline is abandoned for the next one', async () => {
  const hosted = backend('hosted', 'hang');
  const local = backend('local', decision('silent', 0.95));
  const { d, clock, judgeCalls, events } = make({ backends: [hosted, local], judge: JUDGE_ANSWER });
  const p = d.judge(req());
  await flush();
  assert.equal(local.calls, 0, 'local waits for hosted');
  clock.advance(HOSTED_DEADLINE_MS - 1);
  await flush();
  assert.equal(local.calls, 0, 'not before the deadline');
  clock.advance(1);
  await flush();
  assert.equal(hosted.lastSignal.aborted, true, 'the abandoned call is aborted');
  const raw = await p;
  assert.equal(DB.labelOfJudgeReply(raw, CANDIDATE), 'silent');
  assert.equal(judgeCalls.length, 0);
  assert.equal(events[0].decisionBackend, 'local');
});

test('on: unavailable, throwing and malformed backends are skipped', async () => {
  const off = backend('hosted', decision('answer', 1), { available: false });
  const boom = backend('hosted', decision('answer', 1), { available: () => { throw new Error('x'); } });
  const rejects = backend('local', new Error('worker gone'));
  const nan = backend('local', decision('answer', NaN));
  const { d, judgeCalls, events } = make({ backends: [off, boom, rejects, nan], judge: JUDGE_SILENT });
  assert.equal(await d.judge(req()), JUDGE_SILENT);
  assert.equal(off.calls + boom.calls, 0);
  assert.equal(judgeCalls.length, 1);
  assert.equal(events[0].escalateReason, 'backends_failed');
});

test('on: no backend at all escalates as no_backend', async () => {
  const { d, events } = make({ backends: [], judge: JUDGE_ANSWER });
  assert.equal(await d.judge(req()), JUDGE_ANSWER);
  assert.equal(events[0].escalateReason, 'no_backend');
});

test('on: escalated + judge failed → doubt answers only when the top choice was answer', async () => {
  for (const [choice, judge, expect] of [
    ['answer', () => Promise.reject(new Error('down')), 'answer'],
    ['answer', 'garbage', 'answer'],
    ['silent', 'garbage', null],
    ['wait', null, null],
  ]) {
    const { d, events } = make({ backends: [backend('local', decision(choice, 0.5))], judge });
    const raw = await d.judge(req());
    const label = DB.labelOfJudgeReply(raw, CANDIDATE);
    assert.equal(label, expect, `${choice} + ${String(judge)}`);
    assert.equal(events[0].doubtAnswered ?? false, expect === 'answer', `${choice}: doubtAnswered`);
  }
});

test('on: an aborted request never doubt-answers', async () => {
  const ctl = new AbortController();
  const { d } = make({
    backends: [backend('local', decision('answer', 0.5))],
    judge: () => { ctl.abort(); return Promise.resolve(null); },
  });
  assert.equal(await d.judge(req(), ctl.signal), null);
});

test('a judge error reaches the engine unchanged in off and shadow, and in on unless doubt answers', async () => {
  const boom = () => Promise.reject(new Error('judge down'));
  await assert.rejects(make({ mode: 'off', judge: boom }).d.judge(req()), /judge down/);
  const sh = make({ mode: 'shadow', backends: [backend('local', decision('answer', 0.99))], judge: boom });
  await assert.rejects(sh.d.judge(req()), /judge down/);
  await flush();
  assert.equal(sh.events.length, 1, 'shadow still records the decider');
  assert.equal(sh.events[0].judgeLabel, undefined);
  await assert.rejects(make({ backends: [backend('local', decision('silent', 0.5))], judge: boom }).d.judge(req()), /judge down/);
});

test('telemetry carries enums, numbers and booleans only, never text', async () => {
  const ALLOWED = new Set(['name', 'questionId', 'decisionMode', 'decisionBackend', 'decisionAction', 'decisionChoice',
    'decisionConfidence', 'decisionMs', 'escalated', 'escalateReason', 'judgeLabel', 'shadowAgree', 'doubtAnswered']);
  const ENUMS = new Set(['auto_answer_decided', 'shadow', 'on', 'local', 'hosted', 'none', 'answer', 'silent', 'wait', 'escalate',
    'below_threshold', 'truncated', 'backends_failed', 'no_backend']);
  const runs = [
    make({ mode: 'shadow', backends: [backend('local', decision('answer', 0.95))], judge: JUDGE_SILENT }),
    make({ backends: [backend('hosted', decision('wait', 0.99))], judge: JUDGE_SILENT }),
    make({ backends: [backend('local', decision('answer', 0.2))], judge: null }),
  ];
  for (const r of runs) { await r.d.judge(req({ questionId: 'q-42' })); await flush(); }
  const all = runs.flatMap((r) => r.events);
  assert.equal(all.length, 3);
  for (const e of all) {
    for (const [k, v] of Object.entries(e)) {
      assert.ok(ALLOWED.has(k), `unexpected key ${k}`);
      if (typeof v === 'string' && k !== 'questionId') assert.ok(ENUMS.has(v), `${k}=${v} is not an enum value`);
      assert.ok(['string', 'number', 'boolean'].includes(typeof v), `${k} is ${typeof v}`);
    }
    assert.ok(!JSON.stringify(e).includes('shard'), 'no candidate text');
  }
});

// ── app wiring ───────────────────────────────────────────────────────────────────────────────

test('appDecider: packaged default is off and calls the judge hook itself, errors included; no backend is built', async () => {
  let built = 0;
  const judge = (r, s) => (r.candidateText === 'boom' ? Promise.reject(new Error('judge down')) : Promise.resolve(JUDGE_SILENT));
  const a = createAppDecider({ platform: 'win32', env: {}, isPackaged: true, clock: new FakeClock(), llmJudge: judge, backends: () => { built++; return []; } });
  assert.equal(a.mode, 'off');
  assert.equal(await a.judgeCandidate(req()), JUDGE_SILENT);
  await assert.rejects(a.judgeCandidate(req({ candidateText: 'boom' })), /judge down/);
  a.warmUp(); a.dispose();
  assert.equal(built, 0);
});

test('appDecider: dev default is shadow; with a backend it records, and the judge still decides', async () => {
  const events = [];
  for (const platform of ['darwin', 'win32']) {
    const a = createAppDecider({
      platform, env: {}, isPackaged: false, clock: new FakeClock(), llmJudge: async () => JUDGE_ANSWER,
      backends: () => [Object.assign(backend('local', decision('silent', 0.99)), { thresholds: () => ({ answer: 0.5, silent: 0.5, wait: 0.5 }) })],
      telemetry: (e) => events.push(e),
    });
    assert.equal(a.mode, 'shadow');
    assert.equal(await a.judgeCandidate(req()), JUDGE_ANSWER, platform);
  }
  await flush();
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.decisionAction === 'silent' && e.shadowAgree === false));
});

test("appDecider: on mode gates with the deciding backend's own thresholds", async () => {
  const mk = (t) => createAppDecider({
    platform: 'darwin', env: { NATIVELY_AUTO_ANSWER_DECIDER: 'on' }, isPackaged: true, clock: new FakeClock(), llmJudge: async () => JUDGE_SILENT,
    backends: () => [Object.assign(backend('local', decision('answer', 0.9)), { thresholds: () => t })],
  });
  assert.equal(DB.labelOfJudgeReply(await mk({ answer: 0.85, silent: 1, wait: 1 }).judgeCandidate(req()), CANDIDATE), 'answer');
  assert.equal(await mk({ answer: 0.95, silent: 1, wait: 1 }).judgeCandidate(req()), JUDGE_SILENT);
});
