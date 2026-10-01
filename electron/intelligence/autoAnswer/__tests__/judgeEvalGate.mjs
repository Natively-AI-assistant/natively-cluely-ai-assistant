/**
 * Judge regression GATE (2026-09-27). Runs every judge-eval set against the
 * live judge RUNS times, averages precision and recall per set, and fails when
 * any set falls below its committed baseline (judge-eval-baseline.json). Meant to
 * run unattended (nightly), so a model swap or a server-side decision-tier
 * change that silently moves the judge is caught before users meet it.
 *
 *   npm run test:auto-answer:judge-gate                       # Natively rung, 3 runs
 *   JUDGE_GATE_RUNS=5 JUDGE_EVAL_PROVIDER=deepseek npm run test:auto-answer:judge-gate
 *   node …/judgeEvalGate.mjs --update-baseline                # re-baseline after a deliberate change
 *
 * Exit codes: 0 no set regressed, 1 a regression, 2 the run itself failed (no
 * key, network, calls that errored). A set without a baseline for this
 * provider is reported, never failed.
 *
 * What counts as a regression is COUNTED, not a rate: the mean number of false
 * fires, or of misses, rose by more than one case in one pass. The judge is not
 * deterministic at the edges (live lec 7/8 then 8/8 on the same script), and
 * several sets hold only 3-4 asks, where one case moves precision by 0.15-0.25
 * and not linearly: any fixed rate margin either pages on a single flake or
 * misses a real flip. One case flipped in every pass is +1 and fails; one
 * flake in one pass is +1/RUNS and does not. (With RUNS=1 one case is always
 * tolerated: a single pass cannot tell a flake from a flip.)
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
const BASELINE = process.env.JUDGE_GATE_BASELINE ?? path.join(__dirname, 'judge-eval-baseline.json');
const RUNS = Math.max(1, Number(process.env.JUDGE_GATE_RUNS ?? 3));
const PROVIDER = process.env.JUDGE_EVAL_PROVIDER ?? 'natively';
const UPDATE = process.argv.includes('--update-baseline');
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
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const mine = baseline[PROVIDER] ?? {};
const regressions = [];
const summary = [];
for (const [set, e] of [...bySet].sort()) {
  const p = mean(e.runs.map((r) => r.precision));
  const rc = mean(e.runs.map((r) => r.recall));
  const fp = mean(e.runs.map((r) => r.fp));
  const fn = mean(e.runs.map((r) => r.fn));
  // A baseline for a different set size belongs to an edited set: stale, not failed.
  const b = mine[set] && mine[set].n === e.n ? mine[set] : null;
  const stale = Boolean(mine[set] && !b);
  const allowed = 1 / RUNS + 1e-9;
  const bad = Boolean(b && (fp - b.fp > allowed || fn - b.fn > allowed));
  if (bad) regressions.push(set);
  // Which cases flipped, across runs: the thing to read when a set regresses.
  const flips = (key) => [...new Set(e.runs.flatMap((r) => r[key]))].sort((a, b) => a - b);
  summary.push({ set, n: e.n, precision: p, recall: rc, fp, fn, base: b, stale, bad, falseFires: flips('falseFires'), misses: flips('misses') });
  if (UPDATE) {
    mine[set] = { n: e.n, fp: Number(fp.toFixed(3)), fn: Number(fn.toFixed(3)), precision: Number(p.toFixed(3)), recall: Number(rc.toFixed(3)) };
  }
}

console.log(`\nJudge gate · ${PROVIDER}/${[...bySet.values()][0]?.model} · ${RUNS} run(s) · ${calls} calls`);
for (const s of summary) {
  const fl = s.base
    ? `false fires ${s.fp.toFixed(2)} (baseline ${s.base.fp}), misses ${s.fn.toFixed(2)} (baseline ${s.base.fn})`
    : s.stale ? 'baseline is for a different set size: re-baseline' : 'no baseline';
  console.log(`${s.bad ? 'REGRESSED' : 'ok       '} ${s.set.padEnd(38)} P=${s.precision.toFixed(3)} R=${s.recall.toFixed(3)}  ${fl}`
    + (s.falseFires.length ? `  false fires #${s.falseFires.join(',#')}` : '')
    + (s.misses.length ? `  misses #${s.misses.join(',#')}` : ''));
}

if (UPDATE) {
  baseline[PROVIDER] = mine;
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`\nbaseline for ${PROVIDER} written to ${path.relative(process.cwd(), BASELINE)}`);
  process.exit(0);
}
if (regressions.length) {
  console.error(`\n${regressions.length} set(s) regressed (more than one case in one pass): ${regressions.join(', ')}`);
  process.exit(1);
}
console.log('\nno set regressed');
