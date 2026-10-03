#!/usr/bin/env node
// Start a supervisor chain only when the machine is quiet: 1-minute load under a threshold AND no other dev:agent app
// running (another session's Electron instance), on two checks in a row. Detached, own session; ONE app at a time.
//   node tools/when-quiet.mjs <chain log> [--max-load 6] [--max-wait-min 360] [KEY=VALUE ...] -- <supervise.mjs args…>
// Two apps plus builds at once took the whole user session down on 2026-10-01; this is the guard for long runs.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.includes('--child')) {
  const c = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--child'], { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env });
  c.unref(); console.log(`armed when-quiet: pid ${c.pid}`); process.exit(0);
}
const rest = args.filter((a) => a !== '--child');
const sep = rest.indexOf('--');
const head = rest.slice(0, sep); const superviseArgs = rest.slice(sep + 1);
const chainLog = head[0];
const num = (k, d) => { const i = head.indexOf(`--${k}`); return i >= 0 ? Number(head[i + 1]) : d; };
const maxLoad = num('max-load', 6); const maxWaitMs = num('max-wait-min', 360) * 60000;
const envPairs = Object.fromEntries(head.filter((a) => /^[A-Z_]+=/.test(a)).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
const log = fs.openSync(path.join(ROOT, chainLog), 'a');
const say = (m) => fs.writeSync(log, `${new Date().toISOString().slice(11, 19)} ${m}\n`);
// Launchers are counted with the platform's own process list; on Windows there is no pgrep, so the check is skipped
// there and only the load gate (always 0 on Windows) applies — this guard is a macOS/Linux harness convenience.
const otherApps = () => { if (process.platform === 'win32') return 0; const r = spawnSync('pgrep', ['-f', 'scripts/dev-agent.mjs'], { encoding: 'utf8' }); return String(r.stdout ?? '').split('\n').filter(Boolean).length; };
const t0 = Date.now(); let ok = 0;
say(`waiting for a quiet machine (load < ${maxLoad}, no other dev:agent app)`);
for (;;) {
  const load = os.loadavg()[0]; const apps = otherApps();
  ok = load < maxLoad && apps === 0 ? ok + 1 : 0;
  if (ok >= 2) break;
  if (Date.now() - t0 > maxWaitMs) { say(`still busy after ${Math.round(maxWaitMs / 60000)} min (load ${load.toFixed(1)}, other apps ${apps}) — giving up`); process.exit(3); }
  await new Promise((r) => setTimeout(r, 30000));
}
say(`quiet (load ${os.loadavg()[0].toFixed(1)}) — starting the chain`);
spawn(process.execPath, [path.join(ROOT, 'tools', 'supervise.mjs'), ...superviseArgs], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...envPairs } }).unref();
