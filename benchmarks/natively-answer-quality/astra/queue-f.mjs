#!/usr/bin/env node
// The judge plan with Fable as the judge (AQ_JUDGE=fable; see astra/client.mjs). Same runner as queue3.mjs: steps in a
// tier run at once, tiers run in order, nothing new starts once a step reports the usage limit, every step is cached
// and resumable. Decisions first; a pair's base is judged before its variant so a shared answer has one score.
//   node astra/queue-f.mjs [--from-tier N] [--to-tier N] [--concurrency 4]
// Sets: abs-dev-f1 / abs-holdout-f1 / abs-sb-f1; replay judgments in results/replay/<name>.judged-fable.jsonl.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const C = String(opt('concurrency', '4'));
const has = (r) => fs.existsSync(path.join(ROOT, r));
// The ids a partial re-run holds (never printed): the kept build before it is judged on exactly those rows.
const idsOf = (run) => (has(`results/${run}/natively_benchmark_full.jsonl`) ? fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).benchmark_id).join(',') : '');
const R = (replay, conc = '2') => [replay, ['astra/judge-replay.mjs', '--replay', `results/replay/${replay}.jsonl`, '--run', 'results/aq2-dev-fix11', '--concurrency', conc], `results/replay/${replay}.jsonl`];
const J = (name, set, run, extra = []) => [name, ['astra/judge.mjs', '--set', set, '--runs', `results/${run}`, '--concurrency', C, ...extra], `results/${run}`];
const TIERS = [
  [['calibrate', ['astra/calibrate.mjs']]],
  // The three prepared changes: bases of different modes share nothing, so they run side by side; variants after.
  [R('lfw-base'), R('ccfin-base'), R('salesfin-base')],
  [R('lfw-bridge-v2'), R('ccfin-nopolicy-v1h'), R('salesfin-shape-v1h')],
  // The kept build (fix13 = fix12 + the refinement notice) on dev: the per-mode starting point under this judge.
  [J('dev-f1-fix13c', 'abs-dev-f1', 'aq2-dev-fix13c')],
  [J('dev-f1-fix13', 'abs-dev-f1', 'aq2-dev-fix13'), J('dev-f1-fix12c-ids', 'abs-dev-f1', 'aq2-dev-fix12c', ['--ids', idsOf('aq2-dev-fix13')])],
  [J('holdout-f1-fix13c', 'abs-holdout-f1', 'aq2-holdout-fix13c')],
  [J('holdout-f1-fix13', 'abs-holdout-f1', 'aq2-holdout-fix13'), J('holdout-f1-fix12c-ids', 'abs-holdout-f1', 'aq2-holdout-fix12c', ['--ids', idsOf('aq2-holdout-fix13')])],
  // The reference build before the claim pass (fix6): what the kept build gained, under this judge.
  [J('holdout-f1-fix6', 'abs-holdout-f1', 'aq2-holdout-fix6')],
  [J('dev-f1-fix6', 'abs-dev-f1', 'aq2-dev-fix6')],
  // Reported only: the notices on typed turns too; reasoning on vs off (Technical interview + Lecture).
  [R('ccfin-nopolicy-v1c'), R('salesfin-shape-v1c'), R('think-off-til')],
  [R('think-low-til')],
];

const logDir = path.join(HERE, 'out', 'logs');
fs.mkdirSync(logDir, { recursive: true });
let limited = false;
const summary = { judge: 'claude-fable-5-1', started_at: new Date().toISOString(), steps: [] };
function runStep([name, argv, needs]) {
  return new Promise((resolve) => {
    if (needs && !has(needs)) { summary.steps.push({ name, skipped: `${needs} missing` }); console.log(`skip ${name}: ${needs} missing`); return resolve(); }
    const log = fs.createWriteStream(path.join(logDir, `f-${name}.log`), { flags: 'a' });
    const t0 = Date.now();
    log.write(`\n=== ${name} ${new Date().toISOString()}\n`);
    console.log(`${new Date().toISOString().slice(11, 19)} start ${name}`);
    const child = spawn(process.execPath, argv, { cwd: ROOT, env: { ...process.env, AQ_JUDGE: 'fable' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const watch = (buf) => { const s = String(buf); log.write(s); if (/fable usage limit/.test(s)) limited = true; };
    child.stdout.on('data', watch); child.stderr.on('data', watch);
    child.on('close', (code) => {
      const seconds = Math.round((Date.now() - t0) / 1000);
      console.log(`${new Date().toISOString().slice(11, 19)} done  ${name} exit ${code} in ${seconds} s${limited ? ' (usage limit hit)' : ''}`);
      summary.steps.push({ name, exit: code, seconds, limited }); log.end(); resolve();
    });
  });
}
const from = Number(opt('from-tier', 0)); const to = Number(opt('to-tier', TIERS.length - 1));
for (let t = from; t <= to && t < TIERS.length; t++) {
  if (limited) { console.log(`usage limit — tier ${t} and later wait`); break; }
  console.log(`\n--- tier ${t}: ${TIERS[t].map((s) => s[0]).join(', ')}`);
  await Promise.all(TIERS[t].map(runStep));
  if (t === 0 && summary.steps.find((s) => s.name === 'calibrate')?.exit !== 0) { console.log('calibration did not pass — stopping'); break; }
}
await new Promise((resolve) => {
  const out = fs.openSync(path.join(logDir, 'decide-fable.md'), 'w');
  spawn(process.execPath, ['astra/decide.mjs'], { cwd: ROOT, env: { ...process.env, AQ_JUDGE: 'fable' }, stdio: ['ignore', out, out] }).on('close', resolve);
});
summary.finished_at = new Date().toISOString(); summary.limited = limited;
fs.writeFileSync(path.join(logDir, `queue-f-${summary.started_at.replace(/[:.]/g, '-')}.json`), JSON.stringify(summary, null, 2));
console.log(`\nqueue-f ${limited ? 'stopped at the usage limit' : 'done'} ${summary.finished_at}`);
