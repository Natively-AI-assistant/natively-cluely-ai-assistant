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

// Tier 1: the current candidate on dev + the generator-ceiling read, pro AND its flash control on the SAME 15 items per
//         mode (astra/sample.mjs) — the ceiling question does not need 2 × 360, and both halves land in one batch.
// Tier 2: the claim verifier in isolation (fix4 on its modes, 25 per mode).
// Tier 3: I16 — the narrowed verifier hand-back replayed on fix6's drafts (gated rows only).
// Tier 4: generalisation (holdout, supp-behavior) + the baseline remainder.
// Tier 5: blind pairwise baseline vs candidate.
// Tier 6: the full replay / fix4 sets (cached, so only the items outside the samples are new calls).
// Pool arithmetic (2026-09-30 11:00Z batch ≈ 850 calls): tiers 1–3 ≈ 360 + 270 + 150 + 140 = 920.
const TIERS = [
  [
    ['calibrate', ['astra/calibrate.mjs']],
  ],
  [
    ['abs-dev-fix6', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix6', '--concurrency', C], 'results/aq2-dev-fix6'],
    ['replay-pro-s15', ['astra/judge-replay.mjs', '--replay', 'results/replay/dev-fix2-pro.jsonl', '--run', 'results/aq2-dev-fix2', '--sample', '15', '--concurrency', C], 'results/replay/dev-fix2-pro.jsonl'],
    ['replay-flash-s15', ['astra/judge-replay.mjs', '--replay', 'results/replay/dev-fix2-flash.jsonl', '--run', 'results/aq2-dev-fix2', '--sample', '15', '--concurrency', C], 'results/replay/dev-fix2-flash.jsonl'],
  ],
  [
    ['abs-dev-fix4-s25', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix4', '--mode', I8_MODES, '--sample', '25', '--concurrency', C], 'results/aq2-dev-fix4'],
  ],
  [
    // I16 (verifier hand-back narrowed): the new wording on fix6's own drafts, gated rows only; its control is fix6's
    // in-app answers (the same drafts through the old wording), judged in tier 1.
    ['replay-cv-handback-v1', ['astra/judge-replay.mjs', '--replay', 'results/replay/f6raw-cv-handback-v1.gated.jsonl', '--run', 'results/aq2-dev-fix6', '--concurrency', C], 'results/replay/f6raw-cv-handback-v1.gated.jsonl'],
  ],
  [
    ['abs-holdout', ['astra/judge.mjs', '--set', 'abs-holdout', '--runs', 'results/aq2-holdout-fix6,results/aq2-holdout-fix2', '--concurrency', C], 'results/aq2-holdout-fix6'],
    ['abs-sb', ['astra/judge.mjs', '--set', 'abs-sb', '--runs', 'results/aq2-sb-fix6,results/aq2-sb-fix2', '--concurrency', C], 'results/aq2-sb-fix6'],
    ['abs-dev-cur', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-cur', '--concurrency', C], 'results/aq2-dev-cur'],
  ],
  [
    ['ab-dev-cur-vs-fix6', ['astra/ab.mjs', '--set', 'ab-dev-cur-vs-fix6', '--a', 'results/aq2-dev-cur', '--b', 'results/aq2-dev-fix6', '--concurrency', C], 'results/aq2-dev-fix6'],
  ],
  [
    ['abs-dev-fix7', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix7', '--concurrency', C], 'results/aq2-dev-fix7'],
    ['abs-dev-fix4', ['astra/judge.mjs', '--set', 'abs-dev', '--runs', 'results/aq2-dev-fix4', '--mode', I8_MODES, '--concurrency', C], 'results/aq2-dev-fix4'],
    ['replay-pro', ['astra/judge-replay.mjs', '--replay', 'results/replay/dev-fix2-pro.jsonl', '--run', 'results/aq2-dev-fix2', '--concurrency', C], 'results/replay/dev-fix2-pro.jsonl'],
    ['replay-flash', ['astra/judge-replay.mjs', '--replay', 'results/replay/dev-fix2-flash.jsonl', '--run', 'results/aq2-dev-fix2', '--concurrency', C], 'results/replay/dev-fix2-flash.jsonl'],
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
