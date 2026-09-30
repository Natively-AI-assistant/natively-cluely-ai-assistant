#!/usr/bin/env node
// Wait until the AgentRouter GPT ration batch opens (02:00 / 11:00 UTC) and the chat probe succeeds; exit 0 then.
// Probes every 60 s from 2 minutes before each batch boundary, otherwise every 10 minutes. Never prints the key.
import { spawnSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const deadline = Date.now() + Number(process.argv[2] ?? 7_000_000);
const nearBatch = () => { const d = new Date(); const m = d.getUTCHours() * 60 + d.getUTCMinutes(); return [120, 660].some((b) => m >= b - 2 && m <= b + 30); };
for (;;) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs')], { encoding: 'utf8' });
  if (r.status === 0) { console.log(`probe OK at ${new Date().toISOString()}`); process.exit(0); }
  if (Date.now() > deadline) { console.log(`still unavailable at ${new Date().toISOString()}: ${String(r.stdout).split('\n').slice(0, 3).join(' | ')}`); process.exit(3); }
  await new Promise((res) => setTimeout(res, nearBatch() ? 60_000 : 600_000));
}
