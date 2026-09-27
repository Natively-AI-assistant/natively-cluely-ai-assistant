/**
 * Judge regression GATE (2026-09-27). Runs every judge-eval set against the
 * live judge RUNS times, averages precision and recall per set, and fails when
 * any set falls below its committed floor (judge-eval-floors.json). Meant to
 * run unattended (nightly), so a model swap or a server-side decision-tier
 * change that silently moves the judge is caught before users meet it.
 *
 *   npm run test:auto-answer:judge-gate                       # Natively rung, 3 runs
 *   JUDGE_GATE_RUNS=5 JUDGE_EVAL_PROVIDER=deepseek npm run test:auto-answer:judge-gate
 *   node …/judgeEvalGate.mjs --update-floors                  # re-baseline after a deliberate change
 *
 * Exit codes: 0 all sets at or above their floor, 1 a regression, 2 the run
 * itself failed (no key, network, calls that errored). A set without a floor
 * for this provider is reported, never failed.
 *
 * Why runs are AVERAGED: the judge is not deterministic at the edges (live
 * lec 7/8 then 8/8 on the same script). A floor compares against the mean of
 * RUNS passes, and floors are set a notch under the baseline mean (FLOOR_SLACK)
 * so one borderline case flipping in one run is not a page.
 *
 * Node only (child_process with an argument array, no shell), so it runs the
 * same on macOS and Windows. Real model, real key: never part of `npm test`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable only so JudgeEvalGate2026_09_27.test.mjs can run the gate on a
// stand-in eval with no key and no network.
const EVAL = process.env.JUDGE_GATE_EVAL ?? path.join(__dirname, 'judgeEval.mjs');
const FLOORS = process.env.JUDGE_GATE_FLOORS ?? path.join(__dirname, 'judge-eval-floors.json');
const RUNS = Math.max(1, Number(process.env.JUDGE_GATE_RUNS ?? 3));
const PROVIDER = process.env.JUDGE_EVAL_PROVIDER ?? 'natively';
/** How far under the baseline mean a new floor sits: about one case in a 30-case set. */
const FLOOR_SLACK = 0.035;
const UPDATE = process.argv.includes('--update-floors');
/**
 * Calls in flight. 1 keeps the Natively rung near 50 calls a minute, well under
 * natively-api's 120/min per key (at 6, 10% of calls were rate-limited). This
 * is a measurement against production, never a load on it.
 */
const CONCURRENCY = Math.max(1, Number(process.env.JUDGE_GATE_CONCURRENCY ?? 1));
/** A run where more than this share of calls errored measures the network, not the judge. */
const MAX_ERROR_SHARE = 0.05;

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-gate-')), 'results.jsonl');
for (let r = 1; r <= RUNS; r++) {
  process.stdout.write(`run ${r}/${RUNS} (${PROVIDER})… `);
  const t0 = Date.now();
  // judgeEval exits 1 on any false fire or miss; that is data here, not failure.
  const res = spawnSync(process.execPath, [EVAL], {
    env: { ...process.env, JUDGE_EVAL_PROVIDER: PROVIDER, JUDGE_EVAL_JSON: out, JUDGE_EVAL_CONCURRENCY: String(CONCURRENCY) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && res.status !== 1) {
    console.error(`\njudgeEval crashed (exit ${res.status}):\n${(res.stderr || res.stdout || '').slice(-2000)}`);
    process.exit(2);
  }
  console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
}

const rows = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const bySet = new Map();
for (const row of rows) {
  const e = bySet.get(row.set) ?? { runs: [], n: row.n, model: row.model };
  e.runs.push(row);
  bySet.set(row.set, e);
}
const calls = rows.reduce((a, r) => a + r.n, 0);
const errors = rows.reduce((a, r) => a + (r.errors ?? 0), 0);
if (calls === 0) { console.error('no results: nothing was judged'); process.exit(2); }
if (errors / calls > MAX_ERROR_SHARE) {
  const kinds = [...new Set(rows.flatMap((r) => r.errorKinds ?? []))].join(', ');
  console.error(`${errors}/${calls} judge calls errored (${kinds || 'unknown'}): this run measured the network, not the judge`);
  process.exit(2);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const floors = fs.existsSync(FLOORS) ? JSON.parse(fs.readFileSync(FLOORS, 'utf8')) : {};
const mine = floors[PROVIDER] ?? {};
const regressions = [];
const summary = [];
for (const [set, e] of [...bySet].sort()) {
  const p = mean(e.runs.map((r) => r.precision));
  const rc = mean(e.runs.map((r) => r.recall));
  const f = mine[set];
  const bad = f && (p < f.precision - 1e-9 || rc < f.recall - 1e-9);
  if (bad) regressions.push(set);
  // Which cases flipped, across runs: the thing to read when a set regresses.
  const flips = (key) => [...new Set(e.runs.flatMap((r) => r[key]))].sort((a, b) => a - b);
  summary.push({ set, n: e.n, precision: p, recall: rc, floor: f ?? null, bad, falseFires: flips('falseFires'), misses: flips('misses') });
  if (UPDATE) {
    mine[set] = {
      precision: Math.max(0, Number((p - FLOOR_SLACK).toFixed(3))),
      recall: Math.max(0, Number((rc - FLOOR_SLACK).toFixed(3))),
    };
  }
}

console.log(`\nJudge gate · ${PROVIDER}/${[...bySet.values()][0]?.model} · ${RUNS} run(s) · ${calls} calls`);
for (const s of summary) {
  const fl = s.floor ? `floor P≥${s.floor.precision.toFixed(3)} R≥${s.floor.recall.toFixed(3)}` : 'no floor';
  console.log(`${s.bad ? 'REGRESSED' : 'ok       '} ${s.set.padEnd(38)} P=${s.precision.toFixed(3)} R=${s.recall.toFixed(3)}  ${fl}`
    + (s.falseFires.length ? `  false fires #${s.falseFires.join(',#')}` : '')
    + (s.misses.length ? `  misses #${s.misses.join(',#')}` : ''));
}

if (UPDATE) {
  floors[PROVIDER] = mine;
  fs.writeFileSync(FLOORS, JSON.stringify(floors, null, 2) + '\n');
  console.log(`\nfloors for ${PROVIDER} written to ${path.relative(process.cwd(), FLOORS)} (baseline mean − ${FLOOR_SLACK})`);
  process.exit(0);
}
if (regressions.length) {
  console.error(`\n${regressions.length} set(s) below floor: ${regressions.join(', ')}`);
  process.exit(1);
}
console.log('\nall sets at or above their floors');
