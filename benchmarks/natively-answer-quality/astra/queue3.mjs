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

// 2026-10-02 02:00Z plan — charter v2, after the 11:00Z batch stopped at 12:26Z on the ACCOUNT quota
// (insufficient_user_quota; whether it refreshes with the batch is not known — the probe simply waits).
// Reordered 2026-10-01 22:30Z, before any of these rows had a score: DECISIONS FIRST, one whole pair per tier.
// The old tier 2 started fifteen steps at once; a short budget would have left every pair half judged and none of the
// three pre-registered rules applicable. A half-judged pair is worth nothing; a partial Starting column is already
// reported as partial. Every step is cached, so only missing rows are judged.
//   1  fix13's rows (17 dev + 10 holdout) and the 2 dev Seminar rows of fix12 lost to the quota.
//   2  Looking for work: lfw-base vs lfw-bridge-v2 (v2 is the build candidate; v1 copies its example phrase).
//   3  Call Center: ccfin-base vs ccfin-nopolicy-v1h.     4  Sales: salesfin-base vs salesfin-shape-v1h.
//      ("h" = the notice on HEARD turns only, which is what the candidate build does: a typed turn is the agent or
//      seller asking the assistant, and the notice describes a reply to the customer. tools/replay-carry.mjs carries
//      base's answer into every row the gate does not touch — 23 of 40 and 26 of 40 — so those pairs are identical
//      instead of two samples of one prompt. The rule stays on all 40. "c" = the notice on typed turns too: last tier,
//      reported, not what is built.)
//   5  the Starting column — main as it was: ~160 dev and ~68 holdout judgments missing.
//   6  reasoning on vs off (Technical interview + Lecture); supp-behavior for fix11, fix12, fix6.
//   7  blind pairwise reference-vs-fix11.   8  fix10.   9  reasoning for the other modes; lfw-bridge-v1; the two "c" sets.
// After the tiers, always: astra/decide.mjs applies the pre-registered rule to the three pairs (no judge calls).
// Then by hand: tools/compose-run.mjs for aq2-dev-fix12c / fix13c and astra/final-report.mjs (docs/REPORT-ASTRA.md §3).
const R = (name, replay, run, conc = '4') => [name, ['astra/judge-replay.mjs', '--replay', `results/replay/${replay}.jsonl`, '--run', `results/${run}`, '--concurrency', conc], `results/replay/${replay}.jsonl`];
const J = (name, set, run) => [name, ['astra/judge.mjs', '--set', set, '--runs', `results/${run}`, '--concurrency', C], `results/${run}`];
const TIERS = [
  [
    ['calibrate', ['astra/calibrate.mjs']],
  ],
  [
    // fix13 (I26, the refinement notice): only the affected conversations were re-run — 17 dev rows, 10 holdout rows.
    J('dev-c2-fix13', 'abs-dev-c2', 'aq2-dev-fix13'),
    J('holdout-c2-fix13', 'abs-holdout-c2', 'aq2-holdout-fix13'),
    J('dev-c2-fix12', 'abs-dev-c2', 'aq2-dev-fix12'),
  ],
  // Each deciding pair is two CONSECUTIVE tiers, base then variant. Side by side, the variant reached a row whose
  // answer it shares with base (a carried row, or a byte-identical verifier output) before base had written the
  // judge's cache file, and the same answer was judged twice — two scores for one answer, and a call paid twice.
  // Looking for work, a question the material cannot answer: the verifier's fallback rule reworded after the
  // judge's own expected behaviour (facts nearest the question, then one forward-looking or conditional sentence;
  // no holding line). Same 40 dev drafts through the fix12 verifier and the reworded rule.
  [R('lfw-base', 'lfw-base', 'aq2-dev-fix11', '8')],
  [R('lfw-bridge-v2', 'lfw-bridge-v2', 'aq2-dev-fix11', '8')],
  // Call Center with no policy document: a generator-side "no policy on file" notice on heard turns, then the
  // unchanged fix12 verifier.
  [R('ccfin-base', 'ccfin-base', 'aq2-dev-fix11', '8')],
  [R('ccfin-nopolicy-v1h', 'ccfin-nopolicy-v1h', 'aq2-dev-fix11', '8')],
  // Sales with no reference file: a short "how to say it when nothing can be stated" notice to the generator on
  // heard turns, then the unchanged fix12 verifier.
  [R('salesfin-base', 'salesfin-base', 'aq2-dev-fix11', '8')],
  [R('salesfin-shape-v1h', 'salesfin-shape-v1h', 'aq2-dev-fix11', '8')],
  [
    J('dev-c2-cur', 'abs-dev-c2', 'aq2-dev-cur'),
    J('holdout-c2-cur', 'abs-holdout-c2', 'aq-holdout-fix2'),
  ],
  [
    // Reasoning on vs off for the generator (replay of the dev Technical interview + Lecture prompts, 80 rows each):
    // the app sends thinking: disabled on every turn. Measures blocker 2's lever before anyone builds it.
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
    R('lfw-bridge-v1', 'lfw-bridge-v1', 'aq2-dev-fix11'),
    R('ccfin-nopolicy-v1c', 'ccfin-nopolicy-v1c', 'aq2-dev-fix11'),
    R('salesfin-shape-v1c', 'salesfin-shape-v1c', 'aq2-dev-fix11'),
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
// The pre-registered rule, applied mechanically to whatever is judged (local, no judge calls).
await new Promise((resolve) => {
  const out = fs.openSync(path.join(logDir, 'decide.md'), 'w');
  spawn(process.execPath, ['astra/decide.mjs'], { cwd: ROOT, stdio: ['ignore', out, out] }).on('close', resolve);
});
summary.finished_at = new Date().toISOString();
summary.rationed = rationed;
fs.writeFileSync(path.join(logDir, `queue3-${summary.started_at.replace(/[:.]/g, '-')}.json`), JSON.stringify(summary, null, 2));
console.log(`\nqueue3 ${rationed ? 'stopped at the ration' : 'done'} ${summary.finished_at}`);
