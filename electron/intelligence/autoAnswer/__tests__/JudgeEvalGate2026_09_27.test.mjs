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

/** A stand-in judgeEval that appends the given per-set rows to JUDGE_EVAL_JSON. */
function gate({ rows, floors, runs = 2, args = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-gate-test-'));
  const fake = path.join(dir, 'fakeEval.mjs');
  fs.writeFileSync(fake, `import fs from 'node:fs';\nfor (const r of ${JSON.stringify(rows)}) fs.appendFileSync(process.env.JUDGE_EVAL_JSON, JSON.stringify(r) + '\\n');\nprocess.exitCode = 1;\n`);
  const floorsPath = path.join(dir, 'floors.json');
  if (floors) fs.writeFileSync(floorsPath, JSON.stringify(floors));
  const res = spawnSync(process.execPath, [GATE, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', JUDGE_GATE_EVAL: fake, JUDGE_GATE_FLOORS: floorsPath, JUDGE_GATE_RUNS: String(runs), JUDGE_EVAL_PROVIDER: 'natively' },
    encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout + res.stderr, floorsPath };
}
const row = (set, precision, recall, over = {}) => ({ set, provider: 'natively', model: 'm', n: 20, tp: 0, fp: 0, fn: 0, tn: 0, precision, recall, falseFires: [], misses: [], errors: 0, errorKinds: [], ...over });

test('at or above every floor: exit 0', () => {
  const r = gate({ rows: [row('a.json', 1, 0.95)], floors: { natively: { 'a.json': { precision: 0.9, recall: 0.9 } } } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok\s+a\.json/);
});

test('below a floor: exit 1, and the flipped cases are named', () => {
  const r = gate({ rows: [row('a.json', 0.8, 1, { falseFires: [7] })], floors: { natively: { 'a.json': { precision: 0.9, recall: 0.9 } } } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REGRESSED a\.json/);
  assert.match(r.out, /false fires #7/);
});

test('a set with no floor is reported, never failed', () => {
  const r = gate({ rows: [row('new.json', 0.5, 0.5)], floors: { natively: {} } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no floor/);
});

test('calls that mostly errored: exit 2, not a regression and not a pass', () => {
  const r = gate({ rows: [row('a.json', 0.5, 0.5, { errors: 5, errorKinds: ['http_429'] })], floors: { natively: { 'a.json': { precision: 0.9, recall: 0.9 } } } });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /http_429/);
});

test('--update-floors writes the baseline mean minus the slack', () => {
  const r = gate({ rows: [row('a.json', 1, 0.9)], floors: {}, args: ['--update-floors'] });
  assert.equal(r.code, 0, r.out);
  const f = JSON.parse(fs.readFileSync(r.floorsPath, 'utf8')).natively['a.json'];
  assert.equal(f.precision, 0.965);
  assert.equal(f.recall, 0.865);
});
