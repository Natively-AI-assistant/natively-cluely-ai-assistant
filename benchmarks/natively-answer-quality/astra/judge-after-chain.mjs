#!/usr/bin/env node
// Judge runs as soon as a supervisor chain has produced them — detached, in its own session (HTTP only).
//   node astra/judge-after-chain.mjs <chain log> <tag> <set>:<run> [<set>:<run> ...] [--concurrency N]
// Waits for "all runs complete" in the chain log, then judges each run into astra/out/<set>/, one after the other.
// Stops at the first 402 (the ration batch is spent). Log: astra/out/logs/after-<tag>.log
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
if (!args.includes('--child')) {
  const logDir = path.join(HERE, 'out', 'logs'); fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `after-${args[1]}.log`), 'a');
  const c = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--child'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
  c.unref(); console.log(`armed judge-after-chain ${args[1]}: pid ${c.pid}`); process.exit(0);
}
const [chainLog, tag, ...rest] = args.filter((a) => a !== '--child');
const steps = rest.filter((a) => /^[\w-]+:[\w-]+$/.test(a)).map((a) => a.split(':'));
const stamp = () => new Date().toISOString();
for (;;) {
  const t = fs.existsSync(path.join(ROOT, chainLog)) ? fs.readFileSync(path.join(ROOT, chainLog), 'utf8') : '';
  if (/all runs complete/.test(t)) break;
  if (/giving up/.test(t)) { console.log(`${stamp()} chain gave up — nothing judged`); process.exit(3); }
  await new Promise((r) => setTimeout(r, 15000));
}
for (const [set, run] of steps) {
  console.log(`${stamp()} judge ${run} → ${set}`);
  let out = '';
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, ['astra/judge.mjs', '--set', set, '--runs', `results/${run}`, '--concurrency', String(opt('concurrency', '6'))], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const w = (b) => { const s = String(b); out += s; process.stdout.write(s); };
    c.stdout.on('data', w); c.stderr.on('data', w); c.on('close', resolve);
  });
  console.log(`${stamp()} done ${run} exit ${code}`);
  if (/402 ration exhausted/.test(out)) { console.log(`${stamp()} ration spent — stopping`); break; }
}
console.log(`${stamp()} judge-after-chain ${tag} finished`);
