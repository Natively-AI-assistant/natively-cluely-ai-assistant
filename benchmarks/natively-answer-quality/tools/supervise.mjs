#!/usr/bin/env node
// Resilient run chain: keeps a dev:agent instance up and resumes run.mjs until each partition completes.
// Built after other sessions' activity quit every Electron dev instance on the machine twice in 30 min.
//   node tools/supervise.mjs --root <app worktree> --runs dev:aq2-dev-fix1,supp-behavior:aq2-sb-fix1,... [--tries 8]
//   A third field limits the modes: dev:aq2-dev-fix7:looking-for-work+sales+call-center
//   --run-args "--limit 8"  extra run.mjs arguments for every run (space-separated)
// The app is (re)started with NATIVELY_E2E=1 NATIVELY_PROMPT_DEBUG=1 npm run dev:agent, detached, logging to
// scratchpad. run.mjs is resumed (never restarted) so completed rows are kept and partial chains are re-run whole.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(opt('root'));
const RUNS = String(opt('runs')).split(',').map((s) => s.split(':'));
const TRIES = Number(opt('tries', 8));
const RUN_ARGS = opt('run-args') ? String(opt('run-args')).split(/\s+/).filter(Boolean) : [];
const LOG_DIR = process.env.SUPERVISE_LOG_DIR || BENCH;
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
  // --fresh-userdata: every start from an empty profile, so the LLM key is set by run.mjs AFTER startup exactly as
  // on a first launch. A persisted key changes Profile Intelligence extraction from the deterministic heuristic to
  // the LLM path (measured 2026-09-30: 7-minute profile switches and different structured profiles), which would
  // confound any comparison with a run that started fresh. run.mjs re-creates modes, files and PI per unit.
  if (args.includes('--fresh-userdata')) {
    fs.rmSync(path.join(ROOT, '.agent', 'userdata'), { recursive: true, force: true });
    console.log(`${stamp()} userdata wiped`);
  }
  const out = fs.openSync(path.join(LOG_DIR, `app-${path.basename(ROOT)}-${Date.now()}.log`), 'a');
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:agent'], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env, NATIVELY_E2E: '1', NATIVELY_PROMPT_DEBUG: '1' },
  });
  child.unref();
  for (let i = 0; i < 90; i++) { await sleep(2000); if (await appUp()) { await sleep(8000); console.log(`${stamp()} app up`); return; } }
  throw new Error('app did not come up within 3 minutes');
}

for (const [partition, runId, modes] of RUNS) {
  let ok = false;
  for (let t = 1; t <= TRIES && !ok; t++) {
    await ensureApp();
    const dir = path.join(BENCH, 'results', runId);
    const resume = fs.existsSync(path.join(dir, 'run.json'));
    const argv = [path.join(BENCH, 'run.mjs'), '--partition', partition, ...(resume ? ['--resume', runId] : ['--run-id', runId]), ...(modes ? ['--mode', modes.replace(/\+/g, ',')] : []), ...RUN_ARGS, '--no-export'];
    console.log(`${stamp()} ${runId}: try ${t} (${resume ? 'resume' : 'new'})`);
    const log = fs.openSync(path.join(BENCH, 'results', `${runId}.log`), 'a');
    const r = spawnSync(process.execPath, argv, { cwd: BENCH, stdio: ['ignore', log, log], env: { ...process.env, NATIVELY_ROOT: ROOT } });
    const rows = fs.existsSync(path.join(dir, 'natively_benchmark_full.jsonl')) ? fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
    const header = fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
    // A finished run that still holds failed rows (transport errors, the app's canned provider-failure line) is
    // resumed again: run.mjs --resume sets those rows aside with their chains and re-runs them.
    const failed = fs.existsSync(path.join(dir, 'natively_benchmark_full.jsonl'))
      ? fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        .filter((x) => x.success === false || /didn.t come through from the AI provider|couldn.t generate an answer just now|No answer came back this time/i.test(String(x.rendered_answer ?? x.raw_answer ?? ''))).length
      : 0;
    if (failed) console.log(`${stamp()} ${runId}: ${failed} failed row(s) — resuming to re-run them`);
    ok = r.status === 0 && !!header.finished_at && failed === 0;
    console.log(`${stamp()} ${runId}: exit ${r.status}, ${rows} rows${ok ? ' — complete' : ''}`);
    if (!ok) await sleep(15000);
  }
  if (!ok) { console.log(`${stamp()} ${runId}: giving up after ${TRIES} tries`); process.exit(3); }
}
console.log(`${stamp()} all runs complete`);
