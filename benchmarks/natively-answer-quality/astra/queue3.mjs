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

// 2026-10-02 02:00Z plan — charter v2, gpt-6-astra, the ONLY judge (Evin, 01:00Z: "use gpt astra 6 only").
// The Fable series (abs-*-f1, *.judged-fable.jsonl) decided nothing that stands: every decision it touched is
// re-made here. The 11:00Z batch stopped at 12:26Z on the ACCOUNT quota (insufficient_user_quota); whether it
// refreshes with the batch is not known — the probe simply waits.
// DECISIONS FIRST, one pair at a time, base before variant (a shared answer is judged once; a half-judged pair is
// worth nothing). Every step is cached, so only missing rows are judged.
//   1      fix13's rows (17 dev + 10 holdout) and the 2 dev Seminar rows of fix12 lost to the quota.
//   2-3    reasoning on TYPED turns vs off, dev (Technical interview + Lecture, 80 prompts)  → decides I28
//   4-5    the same on holdout (60 prompts, aggregate only)
//   then, after the three pairs below: reasoning on ALL turns (dev + holdout) — reported only, Evin's heard question
//   6-7    Looking for work: lfw-base vs lfw-bridge-v2
//   8-9    Call Center: ccfin-base vs ccfin-nopolicy-v1h      10-11  Sales: salesfin-base vs salesfin-shape-v1h
//   12     the app rows of the candidates: fix15 (reasoning on typed turns), fix14 (Looking-for-work rule), then
//          fix16 (Call Center + Sales notices). Tier numbers below are one or two higher than written here: the
//          fix13c composites sit after tier 1 and fix16 has a tier of its own.
//   13     the Starting column — main as it was: ~160 dev and ~68 holdout judgments missing.
//   14-15  the claim pass on the same rows: draft, then shown (dev and holdout edited rows)
//   16     supp-behavior for fix11, fix12, fix6.   17  blind pairwise reference-vs-fix11.   18  fix10.
//   19     reported only: reasoning for the other modes; lfw-bridge-v1; the notices on typed turns too.
// After the tiers, always: astra/decide.mjs applies the pre-registered rules (no judge calls).
const R = (name, replay, run, extra = []) => [name, ['astra/judge-replay.mjs', '--replay', `results/replay/${replay}.jsonl`, '--run', `results/${run}`, '--concurrency', C, ...extra], `results/replay/${replay}.jsonl`];
const J = (name, set, run) => [name, ['astra/judge.mjs', '--set', set, '--runs', `results/${run}`, '--concurrency', C], `results/${run}`];
const D = 'aq2-dev-fix11'; const H = 'aq2-holdout-fix11'; const AGG = ['--aggregate'];
const TIERS = [
  [['calibrate', ['astra/calibrate.mjs']]],
  [J('dev-c2-fix13', 'abs-dev-c2', 'aq2-dev-fix13'), J('holdout-c2-fix13', 'abs-holdout-c2', 'aq2-holdout-fix13'), J('dev-c2-fix12', 'abs-dev-c2', 'aq2-dev-fix12')],
  // The kept build as one run per split (fix12c + fix13's re-run rows): what every candidate's app rows are paired
  // with. Every answer in them was judged in the tier above or earlier, so this costs no judge call.
  [J('dev-c2-fix13c', 'abs-dev-c2', 'aq2-dev-fix13c'), J('holdout-c2-fix13c', 'abs-holdout-c2', 'aq2-holdout-fix13c')],
  // Reasoning: the build (fix15) reasons on TYPED turns only, so the deciding variant is the typed-only set — heard
  // rows carry the reasoning-off answer (no judge call, a difference of exactly 0). The all-turns sets come later
  // and are reported only: they are the evidence for the heard-turn question, which is Evin's to decide.
  [R('think-off-til', 'think-off-til', D)],
  [R('think-low-til-typed', 'think-low-til-typed', D)],
  [R('think-off-til-hold', 'think-off-til-hold', H, AGG)],
  [R('think-low-til-hold-typed', 'think-low-til-hold-typed', H, AGG)],
  [R('lfw-base', 'lfw-base', D)],
  [R('lfw-bridge-v2', 'lfw-bridge-v2', D)],
  [R('ccfin-base', 'ccfin-base', D)],
  [R('ccfin-nopolicy-v1h', 'ccfin-nopolicy-v1h', D)],
  [R('salesfin-base', 'salesfin-base', D)],
  [R('salesfin-shape-v1h', 'salesfin-shape-v1h', D)],
  [R('think-low-til', 'think-low-til', D), R('think-low-til-hold', 'think-low-til-hold', H, AGG)],
  [J('dev-c2-fix15', 'abs-dev-c2', 'aq2-dev-fix15'), J('holdout-c2-fix15', 'abs-holdout-c2', 'aq2-holdout-fix15'), J('dev-c2-fix14', 'abs-dev-c2', 'aq2-dev-fix14'), J('holdout-c2-fix14', 'abs-holdout-c2', 'aq2-holdout-fix14')],
  // Call Center + Sales app rows of the i6 candidate (c399f399), run ahead of the verdict; used only for a part
  // whose replay pair says BUILD.
  [J('dev-c2-fix16', 'abs-dev-c2', 'aq2-dev-fix16'), J('holdout-c2-fix16', 'abs-holdout-c2', 'aq2-holdout-fix16')],
  [J('dev-c2-cur', 'abs-dev-c2', 'aq2-dev-cur'), J('holdout-c2-cur', 'abs-holdout-c2', 'aq-holdout-fix2')],
  [R('f13dev-draft', 'f13dev-draft', 'aq2-dev-fix13c'), R('f13hold-draft', 'f13hold-draft', 'aq2-holdout-fix13c', AGG)],
  [R('f13dev-shown', 'f13dev-shown', 'aq2-dev-fix13c'), R('f13hold-shown', 'f13hold-shown', 'aq2-holdout-fix13c', AGG)],
  [J('sb-c2-fix11', 'abs-sb-c2', 'aq2-sb-fix11'), J('sb-c2-fix12', 'abs-sb-c2', 'aq2-sb-fix12'), J('sb-c2-fix6', 'abs-sb-c2', 'aq2-sb-fix6')],
  [['ab-c2-fix6-vs-fix11', ['astra/ab.mjs', '--set', 'ab-c2-dev-fix6-vs-fix11', '--a', 'results/aq2-dev-fix6', '--b', 'results/aq2-dev-fix11', '--concurrency', C], 'results/aq2-dev-fix11']],
  [J('dev-c2-fix10', 'abs-dev-c2', 'aq2-dev-fix10'), J('holdout-c2-fix10', 'abs-holdout-c2', 'aq2-holdout-fix10')],
  [R('think-off-rest', 'think-off-rest', D), R('think-low-rest', 'think-low-rest', D), R('lfw-bridge-v1', 'lfw-bridge-v1', D), R('ccfin-nopolicy-v1c', 'ccfin-nopolicy-v1c', D), R('salesfin-shape-v1c', 'salesfin-shape-v1c', D)],
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
// The pre-registered rules, applied mechanically to whatever is judged (local, no judge calls): the replay pairs
// (decide.md), then the candidates' app rows against the kept build (promote.md).
for (const [script, file] of [['astra/decide.mjs', 'decide.md'], ['astra/promote.mjs', 'promote.md']]) {
  await new Promise((resolve) => {
    const out = fs.openSync(path.join(logDir, file), 'w');
    spawn(process.execPath, [script], { cwd: ROOT, stdio: ['ignore', out, out] }).on('close', resolve);
  });
}
summary.finished_at = new Date().toISOString();
summary.rationed = rationed;
fs.writeFileSync(path.join(logDir, `queue3-${summary.started_at.replace(/[:.]/g, '-')}.json`), JSON.stringify(summary, null, 2));
console.log(`\nqueue3 ${rationed ? 'stopped at the ration' : 'done'} ${summary.finished_at}`);
