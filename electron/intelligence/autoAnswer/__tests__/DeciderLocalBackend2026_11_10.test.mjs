/**
 * The local decider (campaign Phase 4.2): the pure pipeline over the 303 Python parity fixtures,
 * the model manifest, and the worker host on a fake worker for BOTH platform branches (injected
 * platform; process.platform is never touched).
 *
 * Optional, not in CI: DECIDER_MODEL_DIR=<dir with manifest.json, the graph, tokenizer/> spawns the
 * REAL worker thread through onnxruntime-node and checks its decisions against the fixtures.
 *
 * Mutation probes (progress log, Phase 4):
 *   pipeline drops the fit (serializes unfitted)   → 'pipeline: fixture logits through…'
 *   pipeline marks every decision truncated        → 'pipeline: fixture logits through…'
 *   manifest accepts '..' in a path                → 'manifest: rejects…'
 *   host passes darwin EPs on win32                → 'host: the EP list follows the injected platform'
 *   busy guard removed                             → 'host: one decision in flight…'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/decider', f));
const Pipe = dist('deciderPipeline.js');
const Man = dist('deciderManifest.js');
const { LocalLayaBackend } = dist('LocalLayaBackend.js');
const { adaptTokenizer, specialTokensFromConfig } = dist('layaTokenizer.js');

const FIX = path.join(__dirname, 'decider-fixtures');
const fixture = JSON.parse(fs.readFileSync(path.join(FIX, 'laya-sequence.json'), 'utf8'));
const CFG = {
  maxLen: fixture.max_len, headMaxLen: fixture.head_max_len,
  calibration: { temperature: fixture.calibration.temperature, temperatureByOptions: fixture.calibration.temperature_by_options },
};

async function loadTokenizer() {
  const T = await import('@huggingface/transformers');
  const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'laya-tokenizer', 'tokenizer.json.gz'))).toString('utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(FIX, 'laya-tokenizer', 'tokenizer_config.json'), 'utf8'));
  return adaptTokenizer(new T.PreTrainedTokenizer(json, config), specialTokensFromConfig(config));
}
const tokP = loadTokenizer();

// ── pipeline ─────────────────────────────────────────────────────────────────────────────────

test(`pipeline: fixture logits through fit → sequence → collate → decode give Python's answer (${fixture.cases.length} cases)`, async () => {
  const p = Pipe.prepareDecider(await tokP, CFG);
  assert.equal(p.room, fixture.state_room);
  for (const c of fixture.cases) {
    let seen = null;
    const d = await Pipe.decideFields(p, c.fields, async (batch) => { seen = batch; return c.logits; });
    assert.deepEqual(Array.from(seen.inputIds, Number), c.ids, `${c.id}: ids`);
    assert.equal(seen.n, 1);
    assert.equal(d.choice, c.answer.choice, `${c.id}: choice`);
    for (const k of ['answer', 'silent', 'wait']) assert.ok(Math.abs(d.probabilities[k] - c.answer.probabilities[k]) <= 1e-4, `${c.id}: p(${k})`);
    assert.ok(Math.abs(d.answerConfidence - c.answer.answer_confidence) <= 1e-4, `${c.id}: answerConfidence`);
    assert.equal(d.truncated, c.truncation.truncated, `${c.id}: truncated`);
  }
});

test('pipeline: too few logits for the options is an error, not a decision', async () => {
  const p = Pipe.prepareDecider(await tokP, CFG);
  await assert.rejects(Pipe.decideFields(p, fixture.cases[0].fields, async () => [0.1, 0.2]), /logits for 3 options/);
});

test('pipeline: fieldsForRequest maps the engine request with the shared builder', () => {
  const f = Pipe.fieldsForRequest({
    candidateText: 'Priya, can you walk us through the rollout?', questionId: 'q',
    recentTurns: [{ role: 'interviewer', text: 'ok next item', timestamp: 1 }, { role: 'user', text: 'sure', timestamp: 2 }],
    speakers: ['speaker_2', undefined], modeName: 'Technical Interview', lastAnsweredText: null, userName: 'Priya', transcriptLagging: true,
  });
  assert.equal(f.mode, 'technical-interview');
  assert.equal(f.addressed_to, 'user');
  assert.equal(f.transcript_lagging, true);
  assert.deepEqual(f.context, ['OTHERS/speaker_2: ok next item', 'USER: sure']);
  assert.equal(Pipe.fieldsForRequest({ candidateText: 'x', recentTurns: [], questionId: 'q', modeName: 'My custom mode' }).mode, 'general');
});

// ── manifest ─────────────────────────────────────────────────────────────────────────────────

const GOOD = {
  schema: 1, id: 'natively/auto-answer-decider', version: '2026.11.10', graph: 'laya.int8.onnx',
  max_len: 512, head_max_len: 192,
  calibration: { temperature: [1.2, 1, 1], temperature_by_options: { 'choice:3-5': 1.4 } },
  thresholds: { answer: 0.93, silent: 0.9, wait: 0.97 },
  files: [{ path: 'laya.int8.onnx', sha256: 'a'.repeat(64), bytes: 1 }],
};

test('manifest: a valid one parses with its thresholds and calibration', () => {
  const m = Man.parseDeciderManifest(GOOD);
  assert.deepEqual(m.thresholds, { answer: 0.93, silent: 0.9, wait: 0.97 });
  assert.equal(m.tokenizerDir, 'tokenizer');
  assert.deepEqual(m.config.calibration, { temperature: [1.2, 1, 1], temperatureByOptions: { 'choice:3-5': 1.4 } });
});

test('manifest: missing or invalid thresholds escalate (Infinity), never decide', () => {
  assert.deepEqual(Man.parseDeciderManifest({ ...GOOD, thresholds: undefined }).thresholds, { answer: Infinity, silent: Infinity, wait: Infinity });
  assert.deepEqual(Man.parseDeciderManifest({ ...GOOD, thresholds: { answer: 0, silent: 1.5, wait: 'x' } }).thresholds, { answer: Infinity, silent: Infinity, wait: Infinity });
});

test('manifest: rejects paths that leave the model directory, on POSIX and Windows spellings', () => {
  for (const graph of ['../x.onnx', '/abs/x.onnx', 'C:\\x.onnx', 'a\\..\\..\\x.onnx', '\\\\server\\x.onnx', '']) {
    assert.throws(() => Man.parseDeciderManifest({ ...GOOD, graph }), /graph path/, JSON.stringify(graph));
  }
  assert.throws(() => Man.parseDeciderManifest({ ...GOOD, tokenizer: '../t' }), /tokenizer path/);
  assert.throws(() => Man.parseDeciderManifest({ ...GOOD, files: [{ path: '../x', sha256: 'a'.repeat(64), bytes: 1 }] }), /files entry/);
  assert.throws(() => Man.parseDeciderManifest({ ...GOOD, files: [{ path: 'x', sha256: 'nothex', bytes: 1 }] }), /files entry/);
  assert.throws(() => Man.parseDeciderManifest({ ...GOOD, schema: 2 }), /schema/);
  assert.throws(() => Man.parseDeciderManifest({ ...GOOD, head_max_len: 600 }), /max_len/);
});

// ── host ─────────────────────────────────────────────────────────────────────────────────────

class FakeWorker extends EventEmitter {
  constructor(script) { super(); this.sent = []; this.script = script; }
  postMessage(msg) {
    this.sent.push(msg);
    if (msg.type === 'shutdown') return;
    queueMicrotask(() => this.script?.(msg, this));
  }
}
const DECISION = { choice: 'answer', probabilities: { answer: 0.95, silent: 0.03, wait: 0.02 }, answerConfidence: 0.95, entropyConfidence: 0.7, truncated: false, ms: 210 };
const answerAll = (msg, w) => {
  w.emit('message', { type: 'status', status: { type: 'ready', backend: 'onnx' }, ep: msg.eps[0] });
  w.emit('message', { type: msg.type === 'init' ? 'ready' : 'result', requestId: msg.requestId, result: DECISION });
};

function host({ platform = 'darwin', env = {}, script = answerAll, manifest = GOOD, poisoned = false, dir = '/models/decider' } = {}) {
  const log = { writes: [], clears: [], retired: [], workers: [] };
  const b = new LocalLayaBackend({
    modelDir: () => dir, platform, env, logicalCores: 8,
    exists: (p) => manifest !== null && p === path.join(dir, 'manifest.json'),
    readFile: () => JSON.stringify(manifest),
    createWorker: () => { const w = new FakeWorker(script); log.workers.push(w); return w; },
    sentinel: { write: (id) => log.writes.push(id), clear: (id) => log.clears.push(id), poisoned: () => poisoned },
    retire: (w) => log.retired.push(w),
  });
  return { b, log };
}
const REQ = { candidateText: 'how would you test it?', recentTurns: [], questionId: 'q1' };

test('host: the EP list follows the injected platform (darwin and win32), and no other platform is served', async () => {
  for (const [platform, env, eps] of [
    ['darwin', {}, ['cpu']], ['darwin', { NATIVELY_DECIDER_EP: 'coreml' }, ['coreml', 'cpu']],
    ['win32', {}, ['cpu']], ['win32', { NATIVELY_DECIDER_EP: 'dml' }, ['dml', 'cpu']],
  ]) {
    const { b, log } = host({ platform, env });
    assert.equal(b.isAvailable(), true, platform);
    assert.deepEqual(await b.decide(REQ), DECISION);
    const msg = log.workers[0].sent[0];
    assert.deepEqual(msg.eps, eps, `${platform} ${JSON.stringify(env)}`);
    assert.equal(msg.threads, 4);
    assert.equal(msg.modelDir, '/models/decider');
    assert.equal(b.activeEp, eps[0]);
  }
  assert.equal(host({ platform: 'linux' }).b.isAvailable(), false);
});

test('host: unavailable without a model, with an invalid manifest, or after a poisoned load', () => {
  assert.equal(host({ manifest: null }).b.isAvailable(), false);
  assert.equal(host({ manifest: { ...GOOD, schema: 9 } }).b.isAvailable(), false);
  assert.equal(host({ poisoned: true }).b.isAvailable(), false);
  const { b } = host({ dir: null });
  assert.equal(b.isAvailable(), false);
});

test('host: thresholds come from the manifest; ESCALATE_ALL without one', () => {
  assert.deepEqual(host().b.thresholds(), GOOD.thresholds);
  assert.deepEqual(host({ manifest: { ...GOOD, thresholds: null } }).b.thresholds(), { answer: Infinity, silent: Infinity, wait: Infinity });
  assert.deepEqual(host({ manifest: null }).b.thresholds(), { answer: Infinity, silent: Infinity, wait: Infinity });
});

test('host: the load sentinel is written before spawn and cleared on ready', async () => {
  const { b, log } = host();
  await b.decide(REQ);
  assert.equal(log.writes.length, 1);
  assert.deepEqual(log.clears, log.writes);
});

test('host: one decision in flight; a second is refused at once', async () => {
  let hold = null;
  const { b } = host({ script: (msg, w) => { hold = () => answerAll(msg, w); } });
  const first = b.decide(REQ);
  await assert.rejects(b.decide(REQ), /busy/);
  await new Promise((r) => setTimeout(r, 0));
  hold();
  assert.deepEqual(await first, DECISION);
  const second = b.decide(REQ);
  await new Promise((r) => setTimeout(r, 0));
  hold();
  assert.deepEqual(await second, DECISION, 'free again once the first settled');
});

test('host: abort rejects at once and frees the slot for the next candidate', async () => {
  let calls = 0;
  const { b } = host({ script: (msg, w) => { calls++; if (calls > 1) answerAll(msg, w); } });
  const ctl = new AbortController();
  const p = b.decide(REQ, ctl.signal);
  ctl.abort();
  await assert.rejects(p, /aborted/);
  assert.deepEqual(await b.decide(REQ), DECISION);
});

test('host: a worker that exits fails the pending call; a non-recoverable failure disables the backend', async () => {
  const { b } = host({ script: (_m, w) => w.emit('exit', 1) });
  await assert.rejects(b.decide(REQ), /worker gone/);
  const bad = host({ script: (msg, w) => {
    w.emit('message', { type: 'status', status: { type: 'failed', backend: 'none', reason: 'x', message: 'x', recoverable: false } });
    w.emit('message', { type: 'error', requestId: msg.requestId, error: 'load failed' });
  } });
  await assert.rejects(bad.b.decide(REQ), /load failed/);
  assert.equal(bad.b.isAvailable(), false);
});

test('host: dispose retires the worker cooperatively and fails anything pending', async () => {
  const { b, log } = host({ script: () => {} });
  const p = b.decide(REQ);
  await new Promise((r) => setTimeout(r, 0));
  b.dispose();
  await assert.rejects(p, /disposed/);
  assert.equal(log.retired.length, 1);
});

// ── gold requests: the engine's request shape rebuilds the fixture fields exactly ─────────────

/** A judge-eval case as the engine would send it, the way bench/emit_eval_states.mjs builds it. */
function goldRequest(id) {
  const m = /^gold:(.+)#(\d+)$/.exec(id);
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'judge-eval', m[1]), 'utf8'))[Number(m[2])];
  return {
    candidateText: c.text, questionId: id,
    recentTurns: (c.ctx ?? []).map((t, k) => ({ ...t, timestamp: k })),
    modeName: c.modeName ?? 'Technical Interview',
    lastAnsweredText: c.lastAnswered ?? null, userName: c.userName ?? null, transcriptLagging: false,
  };
}
const GOLD = fixture.cases.filter((c) => c.id.startsWith('gold:'));

test(`pipeline: every gold case as an engine request rebuilds the fixture's fields (${GOLD.length} cases)`, () => {
  assert.ok(GOLD.length >= 180);
  for (const c of GOLD) assert.deepEqual(Pipe.fieldsForRequest(goldRequest(c.id)), c.fields, c.id);
});

// ── the real worker, opt-in ──────────────────────────────────────────────────────────────────

const MODEL_DIR = process.env.DECIDER_MODEL_DIR;
test('real worker: onnxruntime-node in a worker thread reproduces the fp32 fixtures on gold requests',
  { skip: !MODEL_DIR && 'set DECIDER_MODEL_DIR (a model dir with an fp32 graph)' }, async () => {
  const { createLocalLayaBackend } = dist('LocalLayaBackend.js');
  const b = createLocalLayaBackend(() => MODEL_DIR, process.platform);
  assert.equal(b.isAvailable(), true);
  const cases = GOLD.slice(0, Number(process.env.DECIDER_REAL_N || GOLD.length));
  const ms = [];
  try {
    for (const c of cases) {
      const d = await b.decide(goldRequest(c.id));
      ms.push(d.ms);
      assert.equal(d.choice, c.answer.choice, `${c.id}: choice`);
      for (const k of ['answer', 'silent', 'wait']) assert.ok(Math.abs(d.probabilities[k] - c.answer.probabilities[k]) <= 1e-3, `${c.id}: p(${k}) ${d.probabilities[k]} vs ${c.answer.probabilities[k]}`);
    }
  } finally { b.dispose(); }
  ms.sort((a, z) => a - z);
  const q = (f) => ms[Math.min(ms.length - 1, Math.floor(f * ms.length))];
  console.log(`real worker ${cases.length} cases, ep=${b.activeEp}: p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${ms.at(-1)} ms (first includes load)`);
});
