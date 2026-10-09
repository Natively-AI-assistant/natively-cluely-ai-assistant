#!/usr/bin/env node
// Keeps one dev:agent instance up and resumes run-er.mjs until each partition completes (same idea as
// ../tools/supervise.mjs, for the evidence-rich runner).
//   node evidence-rich/supervise-er.mjs --root <app worktree> --runs dev:er-dev-base[,holdout:er-holdout-base] [--tries 8]
//   A third field limits the modes: dev:er-dev-smoke:sales+general     --run-args "--limit 2"
// The app is started with NATIVELY_E2E=1 NATIVELY_PROMPT_DEBUG=1 MEASURE_LATENCY=true and
// NATIVELY_E2E_REFERENCE_ROOT=<evidence-rich/evidence>, from an empty profile (--fresh-userdata).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(opt('root'));
const RUNS = String(opt('runs')).split(',').map((s) => s.split(':'));
const TRIES = Number(opt('tries', 8));
const RUN_ARGS = opt('run-args') ? String(opt('run-args')).split(/\s+/).filter(Boolean) : [];
const BENCH = process.env.ER_BENCH_DIR ? path.resolve(process.env.ER_BENCH_DIR) : HERE;
const LOG_DIR = process.env.SUPERVISE_LOG_DIR || path.join(BENCH, 'results');
const POINTER = path.join(BENCH, 'results', '.app-log-path');
fs.mkdirSync(LOG_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

async function appUp() {
  try {
    const port = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-browser.json'), 'utf8')).cdp;
    const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json();
    return list.some((t) => String(t.url).includes('window=launcher')) && list.some((t) => /[?&]window=overlay$/.test(String(t.url)));
  } catch { return false; }
}
async function ensureApp() {
  if (await appUp()) return;
  console.log(`${stamp()} app down — starting dev:agent in ${path.basename(ROOT)}`);
  if (args.includes('--fresh-userdata')) { fs.rmSync(path.join(ROOT, '.agent', 'userdata'), { recursive: true, force: true }); console.log(`${stamp()} userdata wiped`); }
  const logPath = path.join(LOG_DIR, `app-${path.basename(ROOT)}-${Date.now()}.log`);
  const out = fs.openSync(logPath, 'a');
  fs.writeFileSync(POINTER, logPath);
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:agent'], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, NATIVELY_E2E: '1', NATIVELY_PROMPT_DEBUG: '1', MEASURE_LATENCY: 'true', NATIVELY_E2E_REFERENCE_ROOT: process.env.ER_EVID_DIR ? path.resolve(process.env.ER_EVID_DIR) : path.join(HERE, 'evidence') },
  });
  child.unref();
  for (let i = 0; i < 150; i++) { await sleep(2000); if (await appUp()) { await sleep(8000); console.log(`${stamp()} app up`); return; } }
  throw new Error('app did not come up within 5 minutes');
}
const rowsOf = (dir) => { const f = path.join(dir, 'rows.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const FAILED = /didn.t come through from the AI provider|couldn.t generate an answer just now|No answer came back this time/i;

for (const [partition, runId, modes] of RUNS) {
  let ok = false;
  for (let t = 1; t <= TRIES && !ok; t++) {
    await ensureApp();
    const dir = path.join(BENCH, 'results', runId);
    const resume = fs.existsSync(path.join(dir, 'run.json'));
    const argv = [path.join(HERE, 'run-er.mjs'), '--partition', partition, ...(resume ? ['--resume', runId] : ['--run-id', runId]), ...(modes ? ['--mode', modes.replace(/\+/g, ',')] : []), ...RUN_ARGS];
    console.log(`${stamp()} ${runId}: try ${t} (${resume ? 'resume' : 'new'})`);
    const log = fs.openSync(path.join(BENCH, 'results', `${runId}.log`), 'a');
    const r = spawnSync(process.execPath, argv, { cwd: path.join(HERE, '..'), stdio: ['ignore', log, log], env: { ...process.env, NATIVELY_ROOT: ROOT, ER_APP_LOG: fs.existsSync(POINTER) ? fs.readFileSync(POINTER, 'utf8').trim() : '' } });
    const rows = rowsOf(dir);
    const header = fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
    const failed = rows.filter((x) => x.success === false || FAILED.test(String(x.rendered_answer ?? x.raw_answer ?? ''))).length;
    if (failed) console.log(`${stamp()} ${runId}: ${failed} failed or unverified row(s) — resuming to re-run them`);
    ok = r.status === 0 && !!header.finished_at && failed === 0;
    console.log(`${stamp()} ${runId}: exit ${r.status}, ${rows.length} rows${ok ? ' — complete' : ''}`);
    if (!ok) await sleep(15000);
  }
  if (!ok) { console.log(`${stamp()} ${runId}: giving up after ${TRIES} tries`); process.exit(3); }
}
console.log(`${stamp()} all runs complete`);
