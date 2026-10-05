#!/usr/bin/env node
// Prompt replay: re-send the EXACT recorded system + user messages of a run to the same model, optionally
// through a transform (a candidate prompt change), N samples each. A fast inner loop for prompt-level
// changes before they are built into the app and measured end to end (run.mjs). Nothing here is a product
// result: an app run is still required before a change is kept.
//
//   node tools/replay.mjs --run <run-dir-name> --ids A,B | --mode m1,m2 [--where tag=x|cat=y|pi=null]
//        --variant <path to .mjs exporting transform({system,user,item}) → {system,user}> | none
//        --name <out-name> [--n 3] [--concurrency 8] [--model deepseek-flash|deepseek-v4-pro]
// Wire captures are read from the MAIN checkout's results (they are not committed).
// Output: results/replay/<name>.jsonl — {id, mode, variant, k, answer (scratch stripped), scratch, out_tokens, ms, detectors, validator}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate } from '../validators/index.mjs';
import { lexicalDetectors } from '../validators/lexical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MAIN_RESULTS = process.env.NATIVELY_MAIN_RESULTS || '/Users/evin/natively-cluely-ai-assistant/benchmarks/natively-answer-quality/results';
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const name = opt('name'); const N = Number(opt('n', 3)); const CONC = Number(opt('concurrency', 8));
if (!run || !name) { console.error('--run and --name required'); process.exit(2); }
const variantPath = opt('variant', 'none');
const transform = variantPath === 'none' ? (x) => x : (await import(pathToFileURL(path.resolve(variantPath)).href)).transform;

const resultsDir = fs.existsSync(path.join(MAIN_RESULTS, run, 'natively_benchmark_wire.jsonl')) ? path.join(MAIN_RESULTS, run) : path.join(ROOT, 'results', run);
const header = JSON.parse(fs.readFileSync(path.join(resultsDir, 'run.json'), 'utf8'));
const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8'));
const items = Object.fromEntries(ds.items.map((i) => [i.id, i]));
const systems = JSON.parse(fs.readFileSync(path.join(resultsDir, 'systems.json'), 'utf8'));
const wires = fs.readFileSync(path.join(resultsDir, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let pick = wires.filter((w) => w.wire?.system_sha && systems[w.wire.system_sha] && w.messages?.length);
if (opt('ids')) { const s = new Set(opt('ids').split(',')); pick = pick.filter((w) => s.has(w.benchmark_id)); }
if (opt('mode')) { const s = new Set(opt('mode').split(',')); pick = pick.filter((w) => s.has(items[w.benchmark_id]?.mode)); }
if (opt('where')) for (const cond of opt('where').split('|')) {
  const [k, v] = cond.split('=');
  pick = pick.filter((w) => { const it = items[w.benchmark_id]; if (!it) return false; if (k === 'tag') return (it.tags ?? []).includes(v); if (k === 'cat') return it.category === v; if (k === 'pi') return String(it.pi_ref) === v; if (k === 'surface') return it.surface === v; if (k === 'ctx') return it.context_condition === v; return String(it[k]) === v; });
}

const env = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
// --model: the generator (default deepseek-flash, the product benchmark's). deepseek-v4-pro measures the generator ceiling.
const MODEL = (() => { const i = process.argv.indexOf('--model'); return i >= 0 ? process.argv[i + 1] : 'deepseek-flash'; })();
// --thinking enabled [--effort low|high|max]: override the recorded request's `thinking: {type: 'disabled'}` (the app
// switches reasoning off on every turn for a low time to first word). Measures what reasoning would buy.
const THINKING = (() => { const i = process.argv.indexOf('--thinking'); return i >= 0 ? process.argv[i + 1] : null; })();
const EFFORT = (() => { const i = process.argv.indexOf('--effort'); return i >= 0 ? process.argv[i + 1] : null; })();
const { stripCalcScratch } = await import(pathToFileURL(path.resolve(ROOT, '..', '..', 'dist-electron', 'electron', 'llm', 'calcScratch.js')).href).catch(() => ({ stripCalcScratch: (t) => ({ text: t, scratch: null }) }));

async function call(system, user, params) {
  const t0 = Date.now();
  for (let a = 0; a < 4; a++) {
    const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: params?.temperature ?? 0.2, max_tokens: THINKING === 'enabled' ? 6000 : 1500, ...(THINKING ? { thinking: { type: THINKING }, ...(EFFORT ? { reasoning_effort: EFFORT } : {}) } : params?.thinking ? { thinking: params.thinking } : {}), stream: false }) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * 2 ** a)); continue; }
    const j = await res.json();
    return { text: j.choices?.[0]?.message?.content ?? '', out: j.usage?.completion_tokens ?? null, reasoning_chars: (j.choices?.[0]?.message?.reasoning_content ?? '').length, ms: Date.now() - t0, err: res.ok ? null : JSON.stringify(j).slice(0, 200) };
  }
  return { text: '', out: null, ms: Date.now() - t0, err: 'retries exhausted' };
}
const lim = (n) => { let a = 0; const q = []; const nx = () => { if (a >= n || !q.length) return; a++; const { f, r, j } = q.shift(); f().then(r, j).finally(() => { a--; nx(); }); }; return (f) => new Promise((r, j) => { q.push({ f, r, j }); nx(); }); };
const L = lim(CONC);
const outDir = path.join(ROOT, 'results', 'replay'); fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${name}.jsonl`);
fs.writeFileSync(outFile, '');
let done = 0;
await Promise.all(pick.flatMap((w) => Array.from({ length: N }, (_, k) => L(async () => {
  const item = items[w.benchmark_id];
  const base = { system: systems[w.wire.system_sha], user: w.messages.filter((m) => m.role === 'user').at(-1).text, item };
  const t = transform(base) ?? base;
  const r = await call(t.system, t.user, w.wire.params);
  const { text, scratch } = stripCalcScratch(r.text);
  const rec = { id: w.benchmark_id, mode: item?.mode, surface: item?.surface, variant: path.basename(variantPath), model: MODEL, k, answer: text, scratch, out_tokens: r.out, reasoning_chars: r.reasoning_chars ?? 0, thinking: THINKING ?? 'recorded', ms: r.ms, err: r.err,
    detectors: lexicalDetectors(text, item), validator: item ? validate(item, text, ds) : null };
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  if (++done % 25 === 0) process.stderr.write(`  ${done}/${pick.length * N}\n`);
}))));
const recs = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const agg = {};
for (const r of recs) { const a = (agg[r.mode] ??= { n: 0, epistemic: 0, source_exposure: 0, coaching: 0, meta: 0, val_fail: 0, words: 0 }); a.n++; for (const k of ['epistemic', 'source_exposure', 'coaching', 'meta']) if (r.detectors[k]) a[k]++; if (r.validator?.verdict === 'fail') a.val_fail++; a.words += r.answer.split(/\s+/).filter(Boolean).length; }
for (const a of Object.values(agg)) a.words = Math.round(a.words / a.n);
console.log(`${name}: ${recs.length} answers (${pick.length} items × ${N}) → ${path.relative(ROOT, outFile)}`);
console.table(agg);
