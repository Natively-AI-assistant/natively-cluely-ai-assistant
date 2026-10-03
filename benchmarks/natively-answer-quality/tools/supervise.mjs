#!/usr/bin/env node
// Resilient run chain: keeps a dev:agent instance up and resumes run.mjs until each partition completes.
// Built after other sessions' activity quit every Electron dev instance on the machine twice in 30 min.
//   node tools/supervise.mjs --root <app worktree> --runs dev:aq2-dev-fix1,supp-behavior:aq2-sb-fix1,... [--tries 8]
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
  const out = fs.openSync(path.join(LOG_DIR, `app-${path.basename(ROOT)}-${Date.now()}.log`), 'a');
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:agent'], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env, NATIVELY_E2E: '1', NATIVELY_PROMPT_DEBUG: '1' },
  });
  child.unref();
  for (let i = 0; i < 90; i++) { await sleep(2000); if (await appUp()) { await sleep(8000); console.log(`${stamp()} app up`); return; } }
  throw new Error('app did not come up within 3 minutes');
}

for (const [partition, runId] of RUNS) {
  let ok = false;
  for (let t = 1; t <= TRIES && !ok; t++) {
    await ensureApp();
    const dir = path.join(BENCH, 'results', runId);
    const resume = fs.existsSync(path.join(dir, 'run.json'));
    const argv = [path.join(BENCH, 'run.mjs'), '--partition', partition, ...(resume ? ['--resume', runId] : ['--run-id', runId]), '--no-export'];
    console.log(`${stamp()} ${runId}: try ${t} (${resume ? 'resume' : 'new'})`);
    const log = fs.openSync(path.join(BENCH, 'results', `${runId}.log`), 'a');
    const r = spawnSync(process.execPath, argv, { cwd: BENCH, stdio: ['ignore', log, log], env: { ...process.env, NATIVELY_ROOT: ROOT } });
    const rows = fs.existsSync(path.join(dir, 'natively_benchmark_full.jsonl')) ? fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
    const header = fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
    ok = r.status === 0 && !!header.finished_at;
    console.log(`${stamp()} ${runId}: exit ${r.status}, ${rows} rows${ok ? ' — complete' : ''}`);
    if (!ok) await sleep(15000);
  }
  if (!ok) { console.log(`${stamp()} ${runId}: giving up after ${TRIES} tries`); process.exit(3); }
}
console.log(`${stamp()} all runs complete`);
