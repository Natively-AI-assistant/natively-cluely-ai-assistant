#!/usr/bin/env node
// Wait for a supervisor chain to finish, then start the next one — in its own session, ONE app at a time.
//   node tools/after-chain.mjs <log of the chain to wait for> <next log> [KEY=VALUE ...] -- <supervise.mjs args…>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.includes('--child')) {
  const c = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--child'], { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env });
  c.unref(); console.log(`armed after-chain: pid ${c.pid}`); process.exit(0);
}
const [waitLog, nextLog, ...rest] = args.filter((a) => a !== '--child');
const sep = rest.indexOf('--');
const envPairs = Object.fromEntries(rest.slice(0, sep).map((kv) => kv.split('=')));
const superviseArgs = rest.slice(sep + 1);
for (;;) {
  const t = fs.existsSync(path.join(ROOT, waitLog)) ? fs.readFileSync(path.join(ROOT, waitLog), 'utf8') : '';
  if (/all runs complete/.test(t)) break;
  if (/giving up/.test(t)) process.exit(3);
  await new Promise((r) => setTimeout(r, 20000));
}
const log = fs.openSync(path.join(ROOT, nextLog), 'a');
spawn(process.execPath, [path.join(ROOT, 'tools', 'supervise.mjs'), ...superviseArgs], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...envPairs } }).unref();
