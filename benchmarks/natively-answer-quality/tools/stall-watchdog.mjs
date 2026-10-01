#!/usr/bin/env node
// Watch a supervisor chain for a STALL and clear it — detached, own session.
//   node tools/stall-watchdog.mjs <chain log> --root <app worktree> [--stall-min 6] [--relaunch 3] -- <supervise.mjs args…>
// Seen 2026-10-01: on a profile step the app's structured generation went to the Codex CLI and never returned; the
// run's own 90 s request timeout did not fire and killing run.mjs did not help — only stopping the app's launcher
// did (the supervisor then restarts the app and resumes the run).
// Every minute: the active run is the last "<runId>: try N" line of the chain log; if its row count has not moved
// for --stall-min minutes, the dev:agent launcher whose working directory is --root is stopped (SIGTERM). If the
// chain logs "giving up" (8 tries used), it is relaunched with the same arguments, at most --relaunch times.
// macOS/Linux harness tool (pgrep / lsof); the app itself is not touched by it on Windows.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.includes('--child')) {
  const c = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--child'], { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env });
  c.unref(); console.log(`armed stall-watchdog: pid ${c.pid}`); process.exit(0);
}
const rest = args.filter((a) => a !== '--child');
const sep = rest.indexOf('--');
const head = sep >= 0 ? rest.slice(0, sep) : rest; const superviseArgs = sep >= 0 ? rest.slice(sep + 1) : [];
const chainLog = path.join(ROOT, head[0]);
const opt = (k, d) => { const i = head.indexOf(`--${k}`); return i >= 0 ? head[i + 1] : d; };
const appRoot = path.resolve(opt('root')); const stallMs = Number(opt('stall-min', 6)) * 60000; let relaunchLeft = Number(opt('relaunch', 3));
const logFile = chainLog.replace(/\.log$/, '') + '.watchdog.log';
const say = (m) => fs.appendFileSync(logFile, `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const read = () => (fs.existsSync(chainLog) ? fs.readFileSync(chainLog, 'utf8') : '');
const rowsOf = (runId) => { const f = path.join(ROOT, 'results', runId, 'natively_benchmark_full.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0; };
const launchers = () => String(spawnSync('pgrep', ['-f', 'scripts/dev-agent.mjs'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean)
  .filter((pid) => String(spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout ?? '').split('\n').some((l) => l === `n${appRoot}`));
say(`watching ${path.basename(chainLog)} (stall ${stallMs / 60000} min, app ${appRoot})`);
let last = { run: null, rows: -1, at: Date.now() };
for (;;) {
  await new Promise((r) => setTimeout(r, 60000));
  const t = read();
  // Only the text after the last relaunch marker counts, so an old "giving up" is not read twice.
  const tail = t.slice(t.lastIndexOf('watchdog relaunch') + 1);
  if (/all runs complete/.test(tail)) { say('chain complete — watchdog done'); break; }
  if (/giving up/.test(tail)) {
    if (relaunchLeft <= 0 || !superviseArgs.length) { say('chain gave up; no relaunch left — watchdog done'); break; }
    relaunchLeft--; fs.appendFileSync(chainLog, `${new Date().toISOString().slice(11, 19)} watchdog relaunch (${relaunchLeft} left)\n`);
    const log = fs.openSync(chainLog, 'a');
    spawn(process.execPath, [path.join(ROOT, 'tools', 'supervise.mjs'), ...superviseArgs], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
    say('chain gave up — relaunched'); last = { run: null, rows: -1, at: Date.now() }; continue;
  }
  const m = [...tail.matchAll(/ ([\w-]+): try \d+/g)].pop();
  if (!m) continue;
  const run = m[1]; const rows = rowsOf(run);
  if (run !== last.run || rows !== last.rows) { last = { run, rows, at: Date.now() }; continue; }
  if (Date.now() - last.at < stallMs) continue;
  const pids = launchers();
  say(`${run} stuck at ${rows} rows for ${Math.round((Date.now() - last.at) / 60000)} min — stopping launcher ${pids.join(',') || '(none found)'}`);
  for (const pid of pids) { try { process.kill(Number(pid), 'SIGTERM'); } catch {} }
  last = { run, rows, at: Date.now() };
}
