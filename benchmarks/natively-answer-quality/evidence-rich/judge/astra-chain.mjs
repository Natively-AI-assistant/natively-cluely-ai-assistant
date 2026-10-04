#!/usr/bin/env node
// Detached chain for the canonical judge (gpt-6-astra over AgentRouter), armed while its batch pool is closed.
// It waits for the pool to open, then spends the batch in the order that matters most, and stops at the first 402.
//   nohup node evidence-rich/judge/astra-chain.mjs --not-before 2026-10-04T02:00:00Z [--wait-ms 43200000] &
// Order: probe → calibration (35 of 38 needed, else stop: no batch is judged with an uncalibrated judge) →
//        a 45-row sample already judged by Opus (the Astra/Opus agreement sample) → holdout of the baseline and of E1
//        (blind, aggregates only) → dev rows whose evidence was required, both builds → counterfactual, both →
//        the streamed drafts of replaced rows → the paired oracle-sources rows → isolation, both → the rest of dev.
// Everything goes to judge/out/base/<run>.astra.jsonl (never pooled with the .opus files) and results/astra-chain.log.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ER = path.join(HERE, '..'); const BENCH = path.join(ER, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const notBefore = Date.parse(opt('not-before', new Date().toISOString()));
const waitMs = Number(opt('wait-ms', 12 * 3600 * 1000));
const LOG = path.join(ER, 'results', 'astra-chain.log');
const log = (s) => { const line = `${new Date().toISOString()} ${s}`; fs.appendFileSync(LOG, line + '\n'); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, NATIVELY_ENV_FILE: process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env' };
delete env.AQ_JUDGE; // astra, never the CLI judge
const run = (label, argv) => { log(`start ${label}`); const r = spawnSync(process.execPath, argv, { cwd: BENCH, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); const tail = String(r.stdout ?? '').trim().split('\n').slice(-3).join(' | '); log(`end ${label}: exit ${r.status} ${tail.slice(0, 400)}`); return r; };
const probeOk = () => { spawnSync(process.execPath, [path.join(BENCH, 'astra', 'probe.mjs')], { cwd: BENCH, env, encoding: 'utf8' }); try { return JSON.parse(fs.readFileSync(path.join(BENCH, 'astra', 'probe-result.json'), 'utf8')).ok === true; } catch { return false; } };
const rationed = () => /402|ration exhausted|quota/i.test(fs.readFileSync(LOG, 'utf8').split('\n').slice(-6).join('\n'));

log(`armed; not before ${new Date(notBefore).toISOString()}, waiting at most ${(waitMs / 3600000).toFixed(1)} h`);
while (Date.now() < notBefore) await sleep(60000);
const until = Date.now() + waitMs; let open = false;
while (Date.now() < until) { if (probeOk()) { open = true; break; } log('probe: judge not open yet'); await sleep(10 * 60000); }
if (!open) { log('gave up: gpt-6-astra did not open within the wait; nothing was judged'); process.exit(3); }
log('probe ok: gpt-6-astra is answering');
const cal = run('calibration (astra)', [path.join(HERE, 'calibrate-er.mjs')]);
if (cal.status !== 0) { log('calibration did not pass (35 of 38 needed) or the pool closed: stopping, nothing is judged with this judge'); process.exit(2); }
// the agreement sample: 5 dev rows per mode, chosen by a hash of the id (not by score)
const dev = JSON.parse(fs.readFileSync(path.join(ER, 'datasets', 'dev.json'), 'utf8'));
const sample = [];
for (const m of dev.modes.map((x) => x.key)) sample.push(...dev.items.filter((i) => i.mode === m).map((i) => i.id).sort((a, b) => crypto.createHash('sha256').update(a).digest('hex').localeCompare(crypto.createHash('sha256').update(b).digest('hex'))).slice(0, 5));
const J = path.join(HERE, 'judge-er.mjs'); const R = (r) => `evidence-rich/results/${r}`;
const EV = ['--condition', 'grounded_single,multi_source,conflict_stale,followup'];
const step = (label, r, extra = []) => [label, [J, '--set', 'base', '--runs', R(r), ...extra, ...(/holdout/.test(r) ? ['--blind'] : []), '--concurrency', '3']];
// What decides whether the kept candidate (E1) stands comes first: the blind holdout pair, then the dev pair.
const steps = [
  ['agreement sample (45 dev rows)', [J, '--set', 'base', '--runs', R('er-dev-base'), '--ids', sample.join(','), '--concurrency', '3']],
  step('holdout, baseline (aggregates only)', 'er-holdout-base'), step('holdout, E1 (aggregates only)', 'er-holdout-e1'),
  // what decides E5 (the claim pass shown the whole prompt): E1's holdout drafts, then the holdout of E1 + E5 and its drafts
  // main as it stands (E1 + markup fix + E5 + E2): what Evin has
  step('holdout, main (aggregates only)', 'er-holdout-m1'),
  step('drafts: holdout, E1 (early)', 'er-holdout-e1', ['--draft']), step('holdout, E1 + E5 (aggregates only)', 'er-holdout-s3'), step('drafts: holdout, E1 + E5', 'er-holdout-s3', ['--draft']),
  step('holdout, E2 (two profile modes)', 'er-holdout-s4'),
  step('dev, baseline: evidence conditions', 'er-dev-base', EV), step('dev, E1: evidence conditions', 'er-dev-e1', EV),
  step('counterfactual, baseline', 'er-cf-base'), step('counterfactual, E1', 'er-cf-e1'),
  // the streamed drafts of the rows the claim pass replaced (what sections 6, E3 and E4 of the report rest on)
  step('drafts: dev, E1', 'er-dev-e1', ['--draft']), step('drafts: holdout, E1', 'er-holdout-e1', ['--draft']), step('drafts: counterfactual, E1', 'er-cf-e1', ['--draft']),
  step('drafts: dev, baseline', 'er-dev-base', ['--draft']), step('drafts: counterfactual, baseline', 'er-cf-base', ['--draft']),
  step('oracle-sources', 'er-os-base'),
  step('isolation, baseline', 'er-iso-base'), step('isolation, E1', 'er-iso-e1'),
  step('dev, baseline: the rest', 'er-dev-base'), step('dev, E1: the rest', 'er-dev-e1'),
  // later candidates: their shown answers, then their drafts
  ...(opt('extra-runs') ? String(opt('extra-runs')).split(',').flatMap((r) => [step(`extra ${r}`, r), step(`extra drafts ${r}`, r, ['--draft'])]) : []),
];
for (const [label, argv] of steps) {
  if (!fs.existsSync(path.join(ER, 'results', argv[4].split('/').at(-1), 'rows.jsonl'))) { log(`skip ${label}: run not found`); continue; }
  const r = run(label, argv);
  if (/402 ration exhausted|account quota exhausted|stopping new judge calls/.test(String(r.stderr ?? '') + String(r.stdout ?? ''))) { log('the batch pool closed: chain stops here; the next batch continues from the cache with the same command'); break; }
}
log('chain finished');
