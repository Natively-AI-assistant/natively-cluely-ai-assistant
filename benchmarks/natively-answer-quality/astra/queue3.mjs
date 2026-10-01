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

// 2026-10-02 02:00Z plan — charter v2, filling the gaps the 11:00Z batch left when the ACCOUNT quota ran out at 12:26Z
// (insufficient_user_quota; whether it refreshes with the batch is not known — the probe simply waits).
// Decided already: fix12 (aq-fix2 f0c3a263) is the kept build. Every step is cached, so only missing rows are judged.
// Tier 1: the starting column — main as it was: ~160 dev and ~68 holdout judgments missing.
// Tier 2: the 2 dev Seminar rows of fix12 lost to the quota; supp-behavior for fix11, fix12 (Seminar rows) and fix6.
// Tier 3: blind pairwise reference-vs-fix11.   Tier 4: fix10 (the candidate before the source-word rail).
// After tiers 1–2: re-run tools/compose-run.mjs for aq2-dev-fix12c and astra/final-report.mjs (docs/REPORT-ASTRA.md §3).
const R = (name, replay, run) => [name, ['astra/judge-replay.mjs', '--replay', `results/replay/${replay}.jsonl`, '--run', `results/${run}`, '--concurrency', '4'], `results/replay/${replay}.jsonl`];
const J = (name, set, run) => [name, ['astra/judge.mjs', '--set', set, '--runs', `results/${run}`, '--concurrency', C], `results/${run}`];
const TIERS = [
  [
    ['calibrate', ['astra/calibrate.mjs']],
  ],
  [
    J('dev-c2-cur', 'abs-dev-c2', 'aq2-dev-cur'),
    J('holdout-c2-cur', 'abs-holdout-c2', 'aq-holdout-fix2'),
  ],
  [
    J('dev-c2-fix12', 'abs-dev-c2', 'aq2-dev-fix12'),
    // fix13 (I26, the refinement notice): only the affected conversations were re-run — 17 dev rows, 10 holdout rows.
    J('dev-c2-fix13', 'abs-dev-c2', 'aq2-dev-fix13'),
    J('holdout-c2-fix13', 'abs-holdout-c2', 'aq2-holdout-fix13'),
    // Reasoning on vs off for the generator (replay of the dev Technical interview + Lecture prompts, 80 rows each):
    // the app sends thinking: disabled on every turn. Measures blocker 2's lever before anyone builds it.
    // Looking for work, a question the material cannot answer: the verifier's fallback rule reworded after the
    // judge's own expected behaviour (facts nearest the question, then one forward-looking or conditional sentence;
    // no holding line). Same 40 dev drafts through the fix12 verifier and two wordings.
    R('lfw-base', 'lfw-base', 'aq2-dev-fix11'),
    R('lfw-bridge-v1', 'lfw-bridge-v1', 'aq2-dev-fix11'),
    R('lfw-bridge-v2', 'lfw-bridge-v2', 'aq2-dev-fix11'),
    R('think-off-til', 'think-off-til', 'aq2-dev-fix11'),
    R('think-low-til', 'think-low-til', 'aq2-dev-fix11'),
    J('sb-c2-fix11', 'abs-sb-c2', 'aq2-sb-fix11'),
    J('sb-c2-fix12', 'abs-sb-c2', 'aq2-sb-fix12'),
    J('sb-c2-fix6', 'abs-sb-c2', 'aq2-sb-fix6'),
  ],
  [
    ['ab-c2-fix6-vs-fix11', ['astra/ab.mjs', '--set', 'ab-c2-dev-fix6-vs-fix11', '--a', 'results/aq2-dev-fix6', '--b', 'results/aq2-dev-fix11', '--concurrency', C], 'results/aq2-dev-fix11'],
  ],
  [
    J('dev-c2-fix10', 'abs-dev-c2', 'aq2-dev-fix10'),
    J('holdout-c2-fix10', 'abs-holdout-c2', 'aq2-holdout-fix10'),
  ],
  [
    // Reasoning on vs off for the other seven modes (280 rows each) — last: no objective sign that it helps there.
    R('think-off-rest', 'think-off-rest', 'aq2-dev-fix11'),
    R('think-low-rest', 'think-low-rest', 'aq2-dev-fix11'),
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
    const watch = (buf) => { const s = String(buf); log.write(s); if (/402 ration exhausted|account quota exhausted/.test(s)) rationed = true; };
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
