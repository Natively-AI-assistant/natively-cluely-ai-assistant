#!/usr/bin/env node
// I29 — the Call Center "no policy on file" notice on the final set's Call Center rows, as pre-registered in
// docs/ITERATIONS-ASTRA.md (2026-10-02): generate both arms (three samples on the rows the notice touches), apply
// the kept build's claim pass, judge the DECISION half, apply its rule, and only if it passes judge the
// CONFIRMATION half and apply that rule. Every step is skipped when its output is already complete, so a run cut
// short by the ration continues where it stopped. Runs detached; nothing here prints a row or an id.
//   node astra/enlarged-cc.mjs            (detaches; log: astra/out/logs/enlarged-cc.log, verdicts: enlarged-cc.md)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LOGS = path.join(HERE, 'out', 'logs');
if (!process.argv.includes('--child')) {
  fs.mkdirSync(LOGS, { recursive: true });
  const log = fs.openSync(path.join(LOGS, 'enlarged-cc.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  console.log(`started: pid ${child.pid}, log astra/out/logs/enlarged-cc.log`);
  process.exit(0);
}

const RUN = 'aq2-final-fix13'; const P = 'ccE'; const SAMPLES = 3;
const VARIANT = 'tools/variants/cc-nopolicy-v1h.mjs'; const VERIFIER = 'tools/variants/_claimVerifier-fix12.mjs';
const split = JSON.parse(fs.readFileSync(path.join(ROOT, 'dataset', 'final-split-call-center.json'), 'utf8'));
const HALF = { D: new Set(split.decision), C: new Set(split.confirmation) };
const all = [...split.decision, ...split.confirmation];
const touched = [...split.touched.decision, ...split.touched.confirmation];
const rp = (name) => path.join(ROOT, 'results', 'replay', `${name}.jsonl`);
const rows = (name) => readJsonl(rp(name));
const say = (s) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const node = (argv) => { const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const lastLine = (o) => o.out.trim().split('\n').filter((l) => !/^\s*\d+\/\d+\s*$/.test(l) && !/ExperimentalWarning|MODULE_TYPELESS|Reparsing|trace-warnings|To eliminate/.test(l)).slice(-1)[0] ?? '';

// ---- 1. answers: generator replay, then the kept build's claim pass, per sample ----
for (let s = 1; s <= SAMPLES; s++) {
  const ids = s === 1 ? all : touched;
  for (const [arm, variant] of [['base', 'none'], ['var', VARIANT]]) {
    const gen = `${P}${s}-gen-${arm}`; const fin = `${P}${s}-fin-${arm}`;
    // One Call Center row of the final run has no recorded prompt and cannot be replayed.
    if (rows(fin).length === 0 || rows(fin).length < rows(gen).length) {
      if (rows(gen).length < ids.length - 1) { const o = node(['tools/replay.mjs', '--run', RUN, '--ids', ids.join(','), '--variant', variant, '--name', gen, '--n', '1', '--concurrency', '8']); say(`${gen}: ${rows(gen).length} answers (exit ${o.code})`); }
      const empty = rows(gen).filter((r) => !String(r.answer ?? '').trim()).length;
      if (empty) { say(`${gen}: ${empty} empty answers — stopping before the claim pass`); process.exit(3); }
      const o = node(['tools/verifier-replay.mjs', '--run', RUN, '--module', VERIFIER, '--name', fin, '--ids', ids.join(','), '--answers', rp(gen), '--concurrency', '6']);
      say(lastLine(o).replace(/\s+/g, ' ').slice(0, 200));
    }
    const R = rows(fin);
    if (R.some((r) => r.outcome === 'error') || R.some((r) => !String(r.answer ?? '').trim())) { say(`${fin}: a claim-pass call failed or an answer is empty — stopping`); process.exit(3); }
  }
}
// The untouched rows of sample 1 carry base's answer (judged once, a difference of exactly 0).
if (rows(`${P}1-fin-v1h`).length === 0) say(lastLine(node(['tools/replay-carry.mjs', '--run', RUN, '--variant', VARIANT, '--base', `${P}1-fin-base`, '--from', `${P}1-fin-var`, '--name', `${P}1-fin-v1h`])));

// ---- 2. one file per sample, arm and half ----
const write = (name, R) => fs.writeFileSync(rp(name), R.map((r) => JSON.stringify(r)).join('\n') + (R.length ? '\n' : ''));
for (const h of ['D', 'C']) for (let s = 1; s <= SAMPLES; s++) {
  write(`${P}${s}-base.${h}`, rows(`${P}${s}-fin-base`).filter((r) => HALF[h].has(r.id)));
  write(`${P}${s}-var.${h}`, rows(s === 1 ? `${P}1-fin-v1h` : `${P}${s}-fin-var`).filter((r) => HALF[h].has(r.id)));
}
for (const h of ['D', 'C']) say(`half ${h}: sample 1 ${rows(`${P}1-base.${h}`).length} rows (${rows(`${P}1-var.${h}`).filter((r) => !r.carried).length} touched), samples 2–${SAMPLES} ${rows(`${P}2-base.${h}`).length} rows each`);

// ---- 3. judge a half (base before variant, sample by sample), then its rule ----
function judgeHalf(h) {
  for (let s = 1; s <= SAMPLES; s++) for (const arm of ['base', 'var']) {
    const o = node(['astra/judge-replay.mjs', '--replay', rp(`${P}${s}-${arm}.${h}`), '--run', `results/${RUN}`, '--concurrency', '8', '--aggregate']);
    say(`judged ${P}${s}-${arm}.${h}: ${lastLine(o).slice(0, 120)} (exit ${o.code})`);
    if (/402 ration exhausted|account quota exhausted|disk nearly full/.test(o.out)) { say('judge stopped (ration or disk) — the rest waits; run this script again to continue'); return 2; }
  }
  const d = node(['astra/decide-enlarged.mjs', '--prefix', P, '--half', h, '--samples', String(SAMPLES)]);
  fs.appendFileSync(path.join(LOGS, 'enlarged-cc.md'), `${d.out}\n`);
  say(`half ${h}: ${d.out.split('\n').filter((l) => /Verdict|INCOMPLETE/.test(l)).join(' ')}`);
  return d.code;
}
const dCode = judgeHalf('D');
if (dCode === 0) judgeHalf('C');
else say(dCode === 1 ? 'decision half failed its rule — the confirmation half is not judged' : 'decision half has no verdict yet');
say('enlarged-cc finished');
