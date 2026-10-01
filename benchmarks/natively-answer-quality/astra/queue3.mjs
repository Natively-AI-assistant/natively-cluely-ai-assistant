#!/usr/bin/env node
// Parallel judge plan for a ration batch. The GPT ration is a budget POOL per batch (2026-09-30 11:00Z: ~850
// calls, then 402), so parallelism spends it sooner rather than buying more — priority still decides what gets
// read. Steps run in TIERS: every step in a tier runs at once (each with its own --concurrency), the next tier starts
// when the current one ends, and nothing new starts once any step has seen the 402. Every step is cached and
// resumable, so the next batch continues where this one stopped.
//   node astra/queue3.mjs [--from-tier N] [--concurrency 8]
// Logs: astra/out/logs/<step>.log. Summary: astra/out/logs/queue3-<iso>.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const C = String(opt('concurrency', '8'));
const has = (r) => fs.existsSync(path.join(ROOT, r));
const I8_MODES = 'looking-for-work,sales,call-center,technical-interview,seminar,general';

// 2026-10-01 11:00Z plan. Candidate = fix9 (I18 + language rail + I21 General spoken + I22 Seminar).
// Tier 1: the candidate on dev and on holdout (the two reads the keep decision needs).
// Tier 2: supp-behavior + blind pairwise baseline vs candidate on dev.
// Tier 3: the blind final set, the same 40 items per mode for the baseline run and the candidate.
// Tier 4: attribution and leftovers (I18 alone = fix8; supp-quant; the fix6 pairwise remainder; full replay sets).
// The 02:00Z batch gave ~2,160 judgments before the 402; tiers 1-3 need ~360 + 270 + 72 + 360 + 720.
const TIERS = [
  [
    ['calibrate', ['astra/calibrate.mjs']],
  ],
  [
    ['abs-dev-fix9', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix9', '--concurrency', C], 'results/aq2-dev-fix9'],
    ['abs-holdout-fix9', ['astra/judge.mjs', '--set', 'abs-holdout', '--runs', 'results/aq2-holdout-fix9', '--concurrency', C], 'results/aq2-holdout-fix9'],
  ],
  [
    ['abs-sb-fix9', ['astra/judge.mjs', '--set', 'abs-sb', '--runs', 'results/aq2-sb-fix9', '--concurrency', C], 'results/aq2-sb-fix9'],
    ['ab-dev-cur-vs-fix9', ['astra/ab.mjs', '--set', 'ab-dev-cur-vs-fix9', '--a', 'results/aq2-dev-cur', '--b', 'results/aq2-dev-fix9', '--concurrency', C], 'results/aq2-dev-fix9'],
  ],
  [
    ['abs-final-s40', ['astra/judge.mjs', '--set', 'abs-final', '--runs', 'results/aq2-final-fix9,results/aq-final-fix2', '--sample', '40', '--concurrency', C], 'results/aq2-final-fix9'],
  ],
  [
    ['abs-dev-fix8', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix8', '--concurrency', C], 'results/aq2-dev-fix8'],
    ['abs-sq', ['astra/judge.mjs', '--set', 'abs-sq', '--runs', 'results/aq2-sq-fix9,results/aq2-sq-cur', '--concurrency', C], 'results/aq2-sq-fix9'],
    ['ab-dev-cur-vs-fix6', ['astra/ab.mjs', '--set', 'ab-dev-cur-vs-fix6', '--a', 'results/aq2-dev-cur', '--b', 'results/aq2-dev-fix6', '--concurrency', C], 'results/aq2-dev-fix6'],
  ],
];

const logDir = path.join(HERE, 'out', 'logs');
fs.mkdirSync(logDir, { recursive: true });
let rationed = false;
const summary = { started_at: new Date().toISOString(), steps: [] };

function runStep([name, argv, needs]) {
  return new Promise((resolve) => {
    if (needs && !has(needs)) { summary.steps.push({ name, skipped: `${needs} missing` }); return resolve(); }
    const log = fs.createWriteStream(path.join(logDir, `${name}.log`), { flags: 'a' });
    const t0 = Date.now();
    log.write(`\n=== ${name} ${new Date().toISOString()}\n`);
    console.log(`${new Date().toISOString().slice(11, 19)} start ${name}`);
    const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const watch = (buf) => { const s = String(buf); log.write(s); if (/402 ration exhausted/.test(s)) rationed = true; };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      console.log(`${new Date().toISOString().slice(11, 19)} done  ${name} exit ${code} in ${Math.round(ms / 1000)} s${rationed ? ' (ration hit)' : ''}`);
      summary.steps.push({ name, exit: code, seconds: Math.round(ms / 1000), rationed });
      log.end();
      resolve();
    });
  });
}

const fromTier = Number(opt('from-tier', 0));
for (let t = fromTier; t < TIERS.length; t++) {
  if (rationed) { console.log(`ration spent — tier ${t} and later wait for the next batch`); break; }
  console.log(`\n--- tier ${t}: ${TIERS[t].map((s) => s[0]).join(', ')}`);
  await Promise.all(TIERS[t].map(runStep));
  if (t === 0 && summary.steps.find((s) => s.name === 'calibrate')?.exit !== 0) { console.log('calibration did not pass — stopping'); break; }
}
summary.finished_at = new Date().toISOString();
summary.rationed = rationed;
fs.writeFileSync(path.join(logDir, `queue3-${summary.started_at.replace(/[:.]/g, '-')}.json`), JSON.stringify(summary, null, 2));
console.log(`\nqueue3 ${rationed ? 'stopped at the ration' : 'done'} ${summary.finished_at}`);
