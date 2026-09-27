// The nightly judge gate's own logic, on a stand-in eval: no key, no network.
// judgeEvalGate.mjs averages RUNS passes of judgeEval per set and fails below
// the committed floors; a run whose calls mostly errored is a failed RUN
// (exit 2), never read as a judge regression or a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(__dirname, 'judgeEvalGate.mjs');

/**
 * A stand-in judgeEval: pass k (1-based, counted in a file beside it) appends
 * the rows `passes[k-1]` to JUDGE_EVAL_JSON.
 */
function gate({ passes, baseline, args = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-gate-test-'));
  const fake = path.join(dir, 'fakeEval.mjs');
  const counter = path.join(dir, 'pass');
  fs.writeFileSync(fake, `import fs from 'node:fs';
const passes = ${JSON.stringify(passes)};
const k = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
fs.writeFileSync(${JSON.stringify(counter)}, String(k + 1));
for (const r of passes[k]) fs.appendFileSync(process.env.JUDGE_EVAL_JSON, JSON.stringify(r) + '\\n');
process.exitCode = 1;
`);
  const baselinePath = path.join(dir, 'baseline.json');
  if (baseline) fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  const res = spawnSync(process.execPath, [GATE, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', JUDGE_GATE_EVAL: fake, JUDGE_GATE_BASELINE: baselinePath, JUDGE_GATE_RUNS: String(passes.length), JUDGE_EVAL_PROVIDER: 'natively' },
    encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout + res.stderr, baselinePath };
}
/** One set's result for one pass, from its counts. */
const row = (set, { tp, fp = 0, fn = 0, tn = 10, falseFires = [], misses = [], errors = 0, errorKinds = [] }) => ({
  set, provider: 'natively', model: 'm', n: tp + fp + fn + tn, tp, fp, fn, tn,
  precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1,
  falseFires, misses, errors, errorKinds,
});
// A small set like the real ones: 3 asks, 1 known false fire → P 0.75, R 1.
const BASE = { natively: { 'a.json': { n: 14, fp: 1, fn: 0, precision: 0.75, recall: 1 } } };
const usual = () => row('a.json', { tp: 3, fp: 1, falseFires: [4] });

test('the baseline again: exit 0', () => {
  const r = gate({ passes: [[usual()], [usual()], [usual()]], baseline: BASE });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok\s+a\.json/);
});

test('one extra false fire in ONE pass of three is a flake, not a regression', () => {
  const r = gate({ passes: [[usual()], [row('a.json', { tp: 3, fp: 2, tn: 9, falseFires: [4, 9] })], [usual()]], baseline: BASE });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /false fires 1\.33 \(baseline 1\)/, 'judged against the baseline, not skipped as stale');
});

test('the same extra false fire in EVERY pass is a regression, and the case is named', () => {
  const worse = () => row('a.json', { tp: 3, fp: 2, tn: 9, falseFires: [4, 9] });
  const r = gate({ passes: [[worse()], [worse()], [worse()]], baseline: BASE });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REGRESSED a\.json/);
  assert.match(r.out, /false fires #4,#9/);
});

test('a real ask missed in every pass is a regression', () => {
  const missed = () => row('a.json', { tp: 2, fp: 1, fn: 1, tn: 10, misses: [2] });
  const r = gate({ passes: [[missed()], [missed()], [missed()]], baseline: BASE });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /misses #2/);
});

test('an edited set (different size) is stale, reported and not failed', () => {
  const r = gate({ passes: [[row('a.json', { tp: 3, fp: 4, tn: 20 })]], baseline: BASE });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /different set size/);
});

test('a set with no baseline is reported, never failed', () => {
  const r = gate({ passes: [[row('new.json', { tp: 1, fp: 3 })]], baseline: { natively: {} } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no baseline/);
});

test('calls that mostly errored: exit 2, not a regression and not a pass', () => {
  const r = gate({ passes: [[row('a.json', { tp: 1, fn: 2, errors: 5, errorKinds: ['http_429'] })]], baseline: BASE });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /http_429/);
});

test('--update-baseline writes the mean of the passes', () => {
  const r = gate({ passes: [[usual()], [row('a.json', { tp: 3, tn: 11 })]], baseline: {}, args: ['--update-baseline'] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(r.baselinePath, 'utf8')).natively['a.json'], { n: 14, fp: 0.5, fn: 0, precision: 0.875, recall: 1 });
});
