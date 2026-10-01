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

// 2026-10-01 11:00Z plan — CHARTER v2 (claim kinds). A charter change re-keys every judgment, so everything compared
// from here on is judged again into its own "-c2" sets: charter-v1 files (abs-dev, abs-holdout, …) are never mixed in.
// Candidate = fix11 (claim-kinds verifier + source-word rail). Reference = fix6 (provisional). fix9 = I18 + I21 + I22
// without claim kinds (its holdout is 207 clean rows, no Seminar / Call Center).
// Order = what the promotion decision needs first (a build is promoted only on its holdout read, vs the reference):
// Tier 1: dev — candidate and reference.   Tier 2: holdout — candidate and reference (the deciding pair).
// Tier 3: I25 replay read (44 limit-stating drafts).   Tier 4: fix9 (dev + its 207 holdout rows): superseded by fix11, read for attribution and as the fallback.
// Tier 5: the starting column: main as it was (dev aq2-dev-cur, holdout aq-holdout-fix2).
// Tier 6: supp-behavior, blind pairwise reference-vs-candidate, fix10 (the candidate before the rail).
// Last batch gave ~2,160 judgments: tiers 1-2 need ~720 + 540, tier 3 ~570; tier 4 (630) and later may spill.
const R = (name, replay, run) => [name, ['astra/judge-replay.mjs', '--replay', `results/replay/${replay}.jsonl`, '--run', `results/${run}`, '--concurrency', '4'], `results/replay/${replay}.jsonl`];
const J = (name, set, run) => [name, ['astra/judge.mjs', '--set', set, '--runs', `results/${run}`, '--concurrency', C], `results/${run}`];
const TIERS = [
  [
    ['calibrate', ['astra/calibrate.mjs']],
  ],
  [
    J('dev-c2-fix11', 'abs-dev-c2', 'aq2-dev-fix11'),
    J('dev-c2-fix6', 'abs-dev-c2', 'aq2-dev-fix6'),
  ],
  [
    J('holdout-c2-fix11', 'abs-holdout-c2', 'aq2-holdout-fix11'),
    J('holdout-c2-fix6', 'abs-holdout-c2', 'aq2-holdout-fix6'),
  ],
  [
    // I25 (an honest limit is not a claim): the 44 gated drafts that state a limit, fix11 verifier vs the variant,
    // ~70 judgments. Small and it decides whether fix12 is worth an app run, so it goes before fix9.
    R('i25-base-dev', 'i25-base-dev', 'aq2-dev-fix11'),
    R('i25-var-dev', 'i25-var-dev', 'aq2-dev-fix11'),
    R('i25-base-sb', 'i25-base-sb', 'aq2-sb-fix11'),
    R('i25-var-sb', 'i25-var-sb', 'aq2-sb-fix11'),
  ],
  [
    J('dev-c2-fix9', 'abs-dev-c2', 'aq2-dev-fix9'),
    J('holdout-c2-fix9', 'abs-holdout-c2', 'aq2-holdout-fix9'),
  ],
  [
    J('dev-c2-cur', 'abs-dev-c2', 'aq2-dev-cur'),
    J('holdout-c2-cur', 'abs-holdout-c2', 'aq-holdout-fix2'),
  ],
  [
    ['sb-c2', ['astra/judge.mjs', '--set', 'abs-sb-c2', '--runs', 'results/aq2-sb-fix11,results/aq2-sb-fix6', '--concurrency', C], 'results/aq2-sb-fix11'],
    ['ab-c2-fix6-vs-fix11', ['astra/ab.mjs', '--set', 'ab-c2-dev-fix6-vs-fix11', '--a', 'results/aq2-dev-fix6', '--b', 'results/aq2-dev-fix11', '--concurrency', C], 'results/aq2-dev-fix11'],
    J('dev-c2-fix10', 'abs-dev-c2', 'aq2-dev-fix10'),
    J('holdout-c2-fix10', 'abs-holdout-c2', 'aq2-holdout-fix10'),
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
