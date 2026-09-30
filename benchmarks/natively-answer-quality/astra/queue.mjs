#!/usr/bin/env node
// The judge work queue for one ration batch, in priority order. Each step is resumable (cache + skip-done), so a
// batch that runs out (402) just stops here and the next batch continues from the same place.
//   node astra/queue.mjs [--from <step>]
// Steps: calibrate → A/B (dev, supp-quant, supp-behavior, holdout) → absolute (same runs).
// Calibration must pass (>= 18/20) or the queue stops: the judge is not used as an arbiter until it does.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const exists = (r) => fs.existsSync(path.join(ROOT, r, 'natively_benchmark_full.jsonl'));
// Candidate = I5 (fix2: I1-I5) where it was run; supp-quant and holdout use fix1 (I1-I4; I5 does not touch the
// calculation step, and the I5 holdout run comes later).
const PAIRS = [
  ['dev', 'results/aq2-dev-cur', 'results/aq2-dev-fix2'],
  ['sq', 'results/aq2-sq-cur', 'results/aq2-sq-fix1'],
  ['sb', 'results/aq2-sb-cur', 'results/aq2-sb-fix2'],
  ['holdout', 'results/aq-holdout-fix2', 'results/aq2-holdout-fix1'],
];
const steps = [['calibrate', ['astra/calibrate.mjs']]];
for (const [name, a, b] of PAIRS) if (exists(a) && exists(b)) steps.push([`ab-${name}`, ['astra/ab.mjs', '--set', `ab-${name}-cur-vs-cand`, '--a', a, '--b', b, '--concurrency', '4']]);
for (const [name, a, b] of PAIRS) if (exists(a) && exists(b)) steps.push([`abs-${name}`, ['astra/judge.mjs', '--set', `abs-${name}`, '--runs', `${a},${b}`, '--concurrency', '4']]);
const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
let started = !from;
for (const [name, argv] of steps) {
  if (!started && name !== from) continue;
  started = true;
  console.log(`\n=== ${name} (${new Date().toISOString()})`);
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
  if (name === 'calibrate' && r.status !== 0) { console.log('calibration did not pass — stopping the queue'); process.exit(1); }
  // A 402 ration stop prints "[astra] 402 ration exhausted" to stderr and fails the remaining calls fast.
  if (r.status === 2) { console.log(`${name}: judge unavailable (probe) — stopping`); process.exit(2); }
}
console.log(`\nqueue done ${new Date().toISOString()}`);
