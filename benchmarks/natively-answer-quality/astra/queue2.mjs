#!/usr/bin/env node
// Judge plan for the 2026-10-01 02:00 UTC batch, in priority order. Every step is cached and resumable, so a 402
// (ration spent) stops the queue here and the 11:00 batch continues from the same place.
//   node astra/queue2.mjs [--from <step>]
// 1 calibrate (cached; gate ≥18/20)  2 fix5 absolute, all modes (current candidate: I1–I14)
// 3 v4-pro replay of the I5 prompts (generator ceiling)  4 fix4 absolute on the I8 modes (isolated claim-verifier read)
// 5 flash replay (offset for 3)  6 finish the baseline (aq2-dev-cur)
// 7 supp-behavior fix5 vs fix2  8 holdout fix5 vs fix2  9 blind A/B dev cur vs fix5
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const has = (r) => fs.existsSync(path.join(ROOT, r, 'natively_benchmark_full.jsonl'));
const I8_MODES = 'looking-for-work,sales,call-center,technical-interview,seminar,general';
const STEPS = [
  ['calibrate', ['astra/calibrate.mjs']],
  ['abs-dev-fix5', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix5', '--concurrency', '6'], 'results/aq2-dev-fix5'],
  // Generator ceiling: the I5 prompts answered by deepseek-v4-pro (and, for an apples-to-apples offset, by
  // deepseek-flash through the same replay path). Same charter, cache and official score.
  ['replay-pro', ['astra/judge-replay.mjs', '--replay', 'results/replay/dev-fix2-pro.jsonl', '--run', 'results/aq2-dev-fix2', '--concurrency', '6']],
  ['abs-dev-fix4', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix4', '--mode', I8_MODES, '--concurrency', '6'], 'results/aq2-dev-fix4'],
  // I15 (access-lead strip) touches spoken Team Meet / Recruiting only; I8c is formatting-only.
  ['abs-dev-fix6', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix6', '--mode', 'team-meet,recruiting', '--concurrency', '6'], 'results/aq2-dev-fix6'],
  ['replay-flash', ['astra/judge-replay.mjs', '--replay', 'results/replay/dev-fix2-flash.jsonl', '--run', 'results/aq2-dev-fix2', '--concurrency', '6']],
  ['abs-dev-cur', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-cur', '--concurrency', '6'], 'results/aq2-dev-cur'],
  ['abs-sb', ['astra/judge.mjs', '--set', 'abs-sb', '--runs', 'results/aq2-sb-fix5,results/aq2-sb-fix2', '--concurrency', '6'], 'results/aq2-sb-fix5'],
  ['abs-holdout', ['astra/judge.mjs', '--set', 'abs-holdout', '--runs', 'results/aq2-holdout-fix5,results/aq2-holdout-fix2', '--concurrency', '6'], 'results/aq2-holdout-fix5'],
  ['ab-dev-cur-vs-fix5', ['astra/ab.mjs', '--set', 'ab-dev-cur-vs-fix5', '--a', 'results/aq2-dev-cur', '--b', 'results/aq2-dev-fix5', '--concurrency', '4'], 'results/aq2-dev-fix5'],
];
const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
let started = !from;
for (const [name, argv, needs] of STEPS) {
  if (!started && name !== from) continue;
  started = true;
  if (needs && !has(needs)) { console.log(`skip ${name}: ${needs} not present`); continue; }
  console.log(`\n=== ${name} (${new Date().toISOString()})`);
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
  if (name === 'calibrate' && r.status !== 0) { console.log('calibration did not pass — stopping'); process.exit(1); }
  if (r.status === 2) { console.log(`${name}: judge unavailable (probe/ration) — stopping`); process.exit(2); }
}
console.log(`\nqueue2 done ${new Date().toISOString()}`);
