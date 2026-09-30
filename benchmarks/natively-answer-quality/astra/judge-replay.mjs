#!/usr/bin/env node
// External-judge scores for replay answers (tools/replay.mjs output), so a prompt variant can be judged before it is
// built into the app. Same charter, envelope, cache and official score as astra/judge.mjs. Chains: replay answers are
// judged with the recorded conversation of the run they were replayed from.
//   node astra/judge-replay.mjs --replay results/replay/<name>.jsonl --run results/<source run> [--concurrency 6]
//     [--sample N]  only N items per mode (astra/sample.mjs: the same items for every answer set)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { limiter, assertProbeOk } from './client.mjs';
import { loadRun, judgeRow } from './judge.mjs';
import { mean } from './score.mjs';
import { samplePerMode } from './sample.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const replayFile = path.resolve(ROOT, opt('replay'));
const run = loadRun(path.resolve(ROOT, opt('run')));
try { assertProbeOk(); } catch (e) { console.error(String(e.message)); process.exit(2); }
let recs = fs.readFileSync(replayFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (opt('sample')) {
  const keep = samplePerMode(recs.map((r) => r.id), (id) => run.items[id]?.mode ?? 'unknown', Number(opt('sample')));
  recs = recs.filter((r) => keep.has(r.id));
}
const cacheDir = path.join(HERE, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
const outFile = replayFile.replace(/\.jsonl$/, '.judged.jsonl');
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.ok).map((j) => `${j.benchmark_id}#${j.k}`) : []);
const lim = limiter(Number(opt('concurrency', 6)));
await Promise.all(recs.filter((r) => !done.has(`${r.id}#${r.k}`)).map((r) => lim(async () => {
  const row = { ...run.rowsById[r.id], rendered_answer: r.answer, raw_answer: r.answer };
  const j = await judgeRow({ run, row, repeat: 0, cacheDir });
  fs.appendFileSync(outFile, JSON.stringify({ ...j, k: r.k, variant: r.variant }) + '\n');
})));
const J = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.ok && recs.some((r) => r.id === j.benchmark_id && r.k === j.k));
const by = {};
for (const j of J) (by[j.benchmark_id] ??= []).push(j.official.overall);
for (const [id, v] of Object.entries(by).sort()) console.log(`${id.padEnd(12)} mean ${mean(v).toFixed(2)}  [${v.map((x) => x.toFixed(1)).join(', ')}]`);
console.log(`ALL mean ${(mean(J.map((j) => j.official.overall)) ?? NaN).toFixed(2)} over ${J.length}; hard-fail ${J.filter((j) => j.official.hard_fail).length}`);
