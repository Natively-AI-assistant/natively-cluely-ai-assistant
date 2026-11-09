/**
 * Latency of the decider IN THE APP'S RUNTIME: LocalLayaBackend → deciderWorker (worker thread) →
 * onnxruntime-node, on the 187 gold requests, as the engine would send them. Not a test: a bench.
 *
 *   npm run build:electron
 *   node ml/auto-answer-decider/bench/app_worker_bench.mjs <modelDir> [--repeat 2]
 *
 * Prints p50/p90/p99/max of the backend's own `ms` (tokenize + fit + run + decode, in the worker)
 * and of the host round trip, excluding the first call (session load), plus agreement with the
 * fp32 fixtures' choice. Judge-eval cases are TEST data: this reads them, nothing trains on them.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { createLocalLayaBackend } = require(path.join(root, 'dist-electron/electron/intelligence/autoAnswer/decider/LocalLayaBackend.js'));
const FIX = path.join(root, 'electron/intelligence/autoAnswer/__tests__');
const fixture = JSON.parse(fs.readFileSync(path.join(FIX, 'decider-fixtures/laya-sequence.json'), 'utf8'));
const modelDir = path.resolve(process.argv[2]);
const repeat = Number(process.argv[process.argv.indexOf('--repeat') + 1]) || 1;

function goldRequest(id) {
  const m = /^gold:(.+)#(\d+)$/.exec(id);
  const c = JSON.parse(fs.readFileSync(path.join(FIX, 'judge-eval', m[1]), 'utf8'))[Number(m[2])];
  return { candidateText: c.text, questionId: id, recentTurns: (c.ctx ?? []).map((t, k) => ({ ...t, timestamp: k })),
    modeName: c.modeName ?? 'Technical Interview', lastAnsweredText: c.lastAnswered ?? null, userName: c.userName ?? null, transcriptLagging: false };
}
const gold = fixture.cases.filter((c) => c.id.startsWith('gold:'));
const b = createLocalLayaBackend(() => modelDir, process.platform);
if (!b.isAvailable()) { console.error('backend unavailable for', modelDir); process.exit(1); }
const inner = [], outer = [];
let agree = 0, n = 0, first = null;
for (let r = 0; r < repeat; r++) {
  for (const c of gold) {
    const t0 = performance.now();
    const d = await b.decide(goldRequest(c.id));
    const rt = performance.now() - t0;
    if (first === null) { first = rt; continue; }
    inner.push(d.ms); outer.push(rt); n++;
    if (d.choice === c.answer.choice) agree++;
  }
}
b.dispose();
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(f * s.length))]); };
const line = (name, a) => `${name}: p50 ${q(a, 0.5)} p90 ${q(a, 0.9)} p99 ${q(a, 0.99)} max ${Math.round(Math.max(...a))} ms`;
console.log(JSON.stringify({
  modelDir: path.basename(modelDir), ep: b.activeEp, platform: process.platform, arch: process.arch, cpus: os.cpus().length, cpu: os.cpus()[0]?.model,
  n, firstCallMs: Math.round(first), agreeWithFp32Fixture: `${agree}/${n}`,
  worker: line('worker', inner), roundTrip: line('roundTrip', outer),
}, null, 1));
