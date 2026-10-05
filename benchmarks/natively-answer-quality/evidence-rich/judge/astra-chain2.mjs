#!/usr/bin/env node
// Second detached chain for the canonical judge (gpt-6-astra over AgentRouter). Evin, 2026-10-05: "judge with astra as
// much as possible … as long as astra is available"; the Claude Code judge is not used (quota).
// It waits for the pool to open, spends the batch in the order that decides the most, and stops at the first 402.
//   nohup node evidence-rich/judge/astra-chain2.mjs [--wait-ms 21600000] &
// Order: probe → calibration (the gate) →
//   1. E16b, the two profile modes, control and candidate on dev and dev2 (rule lines 3 and 4)
//   2. E17: the streamed drafts and the shown text of the rows the claim pass edited on the two control runs, then the
//      new texts of the replay arms e17-ctl and e17-conflict
//   3. E16b, the other seven modes, control and candidate (rule line 5)
// Everything goes to judge/out/base/<run>.astra.jsonl (never pooled with .opus or .cc files) and results/astra-chain.log.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ER = path.join(HERE, '..'); const BENCH = path.join(ER, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const waitMs = Number(opt('wait-ms', 6 * 3600 * 1000));
const LOG = path.join(ER, 'results', 'astra-chain.log');
const log = (s) => { const line = `${new Date().toISOString()} ${s}`; fs.appendFileSync(LOG, line + '\n'); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, NATIVELY_ENV_FILE: process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', ER_JUDGE: 'astra' };
delete env.AQ_JUDGE; delete env.ER_JUDGE_ROLE; // astra, never the CLI judge
const CLOSED = /402 ration exhausted|account quota exhausted|stopping new judge calls|Budget pool quota/;
const run = (label, argv) => {
  log(`start ${label}`);
  const r = spawnSync(process.execPath, argv, { cwd: BENCH, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  log(`end ${label}: exit ${r.status}   ${out.trim().split('\n').slice(-2).join('  |  ').slice(0, 300)}`);
  return { status: r.status, out, closed: CLOSED.test(out) };
};
const probeOk = () => { spawnSync(process.execPath, [path.join(BENCH, 'astra', 'probe.mjs')], { cwd: BENCH, env, encoding: 'utf8' }); try { return JSON.parse(fs.readFileSync(path.join(BENCH, 'astra', 'probe-result.json'), 'utf8')).ok === true; } catch { return false; } };

log(`chain2 armed; waiting at most ${(waitMs / 3600000).toFixed(1)} h`);
const until = Date.now() + waitMs; let open = false;
while (Date.now() < until) { if (probeOk()) { open = true; break; } await sleep(2 * 60000); }
if (!open) { log('chain2 gave up: gpt-6-astra did not open within the wait; nothing was judged'); process.exit(3); }
log('chain2 probe ok: gpt-6-astra is answering');
const cal = run('calibration (astra)', [path.join(HERE, 'calibrate-er.mjs')]);
if (cal.status !== 0) { log('calibration did not pass or the pool closed: stopping, nothing is judged with this judge'); process.exit(2); }

const J = path.join(HERE, 'judge-er.mjs'); const R = (r) => `evidence-rich/results/${r}`;
const PAIR = ['er-dev-e13c', 'er-dev-e16b', 'er-dev2-e13c', 'er-dev2-e16b'];
const CTL = ['er-dev-e13c', 'er-dev2-e13c'];
const PI = ['--mode', 'looking-for-work,technical-interview'];
const judge = (label, r, extra = []) => () => run(label, [J, '--set', 'base', '--runs', R(r), ...extra, '--concurrency', '3']);
const editedIds = (r) => fs.readFileSync(path.join(ER, 'results', r, 'rows.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.answer_differs_raw_vs_rendered && String(x.raw_answer ?? '').trim()).map((x) => x.benchmark_id);
/** The new texts of a replay arm: prep writes the derived runs and prints one judge command per run. */
const arm = (name) => () => {
  const p = run(`prep ${name}`, [path.join(ER, 'replay-judge.mjs'), 'prep', '--arm', name, '--runs', CTL.map(R).join(',')]);
  let last = p;
  for (const line of p.out.split('\n')) {
    const m = line.match(/--runs (\S+) --ids (\S+)/); if (!m) continue;
    last = run(`${name}: new texts, ${m[1].split('/').at(-1)}`, [J, '--set', 'base', '--runs', m[1], '--ids', m[2], '--concurrency', '3']);
    if (last.closed) return last;
  }
  return last;
};
const replayDone = () => ['e17-ctl', 'e17-conflict'].every((n) => fs.existsSync(path.join(ER, 'results', 'replay', `${n}.jsonl`)) && fs.readFileSync(path.join(ER, 'results', 'replay', `${n}.jsonl`), 'utf8').split('\n').filter(Boolean).length >= 600);

const steps = [
  ...PAIR.map((r) => judge(`E16b pair, profile modes: ${r}`, r, PI)),
  ...CTL.map((r) => judge(`E17 drafts: ${r}`, r, ['--draft'])),
  ...CTL.map((r) => judge(`E17 shown text of edited rows: ${r}`, r, ['--ids', editedIds(r).join(',')])),
  async () => { for (let i = 0; i < 30 && !replayDone(); i++) await sleep(60000); if (!replayDone()) { log('the E17 replay is not complete: its arms are skipped'); return { closed: false }; } return arm('e17-ctl')(); },
  async () => (replayDone() ? arm('e17-conflict')() : { closed: false }),
  ...PAIR.map((r) => judge(`E16b pair, the other modes: ${r}`, r)),
];
for (const step of steps) {
  const r = await step();
  if (r?.closed) { log('the batch pool closed: chain2 stops here; the next batch continues from the cache with the same command'); break; }
}
log('chain2 finished');
