#!/usr/bin/env node
// Arm a ration batch: wait for the judge probe to pass, run the queue, write the report — in its OWN session
// (detached), so it outlives the terminal that started it. One light node process chain; HTTP only.
//   node astra/arm.mjs <tag> [--not-before 2026-10-01T10:55:00Z] [--wait-ms 20000000] [--concurrency 8]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const tag = args[0];
if (!tag || tag.startsWith('--')) { console.error('usage: node astra/arm.mjs <tag> [--not-before ISO] [--wait-ms N] [--concurrency N]'); process.exit(2); }

if (!args.includes('--child')) {
  const logDir = path.join(HERE, 'out', 'logs'); fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `batch-${tag}.log`), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--child'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  console.log(`armed ${tag}: pid ${child.pid}, log astra/out/logs/batch-${tag}.log`);
  process.exit(0);
}

const run = (argv, out) => new Promise((resolve) => {
  const stdio = out ? ['ignore', fs.openSync(out, 'w'), fs.openSync(out, 'a')] : ['ignore', 'inherit', 'inherit'];
  spawn(process.execPath, argv, { cwd: ROOT, stdio }).on('close', (code) => resolve(code));
});
const notBefore = opt('not-before') ? Date.parse(opt('not-before')) : 0;
// Short sleeps against the wall clock: one long timer runs late when the machine sleeps.
if (notBefore > Date.now()) { console.log(`${new Date().toISOString()} sleeping until ${opt('not-before')}`); while (Date.now() < notBefore) await new Promise((r) => setTimeout(r, 30000)); }
console.log(`${new Date().toISOString()} waiting for the batch`);
const w = await run(['astra/wait-for-batch.mjs', String(opt('wait-ms', '20000000'))]);
if (w === 0) await run(['astra/queue3.mjs', '--concurrency', String(opt('concurrency', '8'))]);
else console.log(`${new Date().toISOString()} judge still unavailable (exit ${w}) — queue not run`);
await run(['astra/report.mjs', '--abs', 'abs-dev-c2,abs-holdout-c2,abs-sb-c2', '--ab', 'ab-c2-dev-fix6-vs-fix10', '--worst', '12', '--json', `astra/out/logs/report-after-${tag}.json`], path.join(HERE, 'out', 'logs', `report-after-${tag}.md`));
console.log(`${new Date().toISOString()} chain ${tag} finished`);
