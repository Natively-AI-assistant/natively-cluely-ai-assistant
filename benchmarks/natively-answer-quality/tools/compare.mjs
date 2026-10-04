#!/usr/bin/env node
// Objective comparison of runs (no judge): evidence reaching the prompt, deterministic validators, lexical
// classes, length, latency. node tools/compare.mjs results/<runA> results/<runB> [...] [--ids-from <run>] [--mode m]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../validators/index.mjs';
import { lexicalDetectors } from '../validators/lexical.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mi = args.indexOf('--mode'); const onlyMode = mi >= 0 ? args[mi + 1] : null;
const runs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--mode');
const pct = (v, p) => { const a = v.filter((x) => x != null).sort((x, y) => x - y); if (!a.length) return null; const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r); return a[lo] + (a[hi] - a[lo]) * (r - lo); };
const f0 = (x) => (x == null ? '-' : Math.round(x));
export function metrics(dir) {
  const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8'));
  const items = Object.fromEntries(ds.items.map((i) => [i.id, i]));
  const rows = fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const by = {};
  for (const r of rows) {
    if (onlyMode && r.mode !== onlyMode) continue;
    const ans = r.rendered_answer ?? r.raw_answer ?? '';
    const it = items[r.benchmark_id];
    for (const key of [r.mode, 'ALL']) {
      const m = (by[key] ??= { n: 0, err: 0, needleItems: 0, needlesAllInPrompt: 0, needleInPromptFrac: 0, val: 0, valPass: 0, epistemic: 0, source_exposure: 0, coaching: 0, meta: 0, words: [], ttft: [], total: [] });
      m.n++; if (!r.success) m.err++;
      if (r.needles?.length && r.context?.reference_file) { m.needleItems++; const k = r.needles_in_prompt.filter(Boolean).length; if (k === r.needles.length) m.needlesAllInPrompt++; m.needleInPromptFrac += k / r.needles.length; }
      const v = it ? validate(it, ans, ds) : { verdict: 'n/a' };
      if (v.verdict !== 'n/a') { m.val++; if (v.verdict === 'pass') m.valPass++; }
      const d = lexicalDetectors(ans, it);
      for (const k of ['epistemic', 'source_exposure', 'coaching', 'meta']) if (d[k]) m[k]++;
      m.words.push(r.word_count_excl_gist ?? r.word_count); m.ttft.push(r.ttft_ms); m.total.push(r.total_latency_ms);
    }
  }
  return { run: header.run_id, commit: header.git_commit?.slice(0, 8), by };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const ms = runs.map((r) => metrics(path.resolve(ROOT, r)));
  const modes = [...new Set(ms.flatMap((m) => Object.keys(m.by)))].sort((a, b) => (a === 'ALL') - (b === 'ALL') || a.localeCompare(b));
  console.log('| mode | run | n | err | ref needles all-in-prompt | validators pass | epistemic | src-exposure | coaching | meta | words | TTFT p50/p95 | total p50/p95 |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const mode of modes) for (const m of ms) {
    const x = m.by[mode]; if (!x) continue;
    console.log(`| ${mode} | ${m.run} | ${x.n} | ${x.err} | ${x.needleItems ? `${x.needlesAllInPrompt}/${x.needleItems}` : '-'} | ${x.val ? `${x.valPass}/${x.val}` : '-'} | ${x.epistemic} | ${x.source_exposure} | ${x.coaching} | ${x.meta} | ${f0(x.words.reduce((a, b) => a + (b ?? 0), 0) / x.n)} | ${f0(pct(x.ttft, 50))}/${f0(pct(x.ttft, 95))} | ${f0(pct(x.total, 50))}/${f0(pct(x.total, 95))} |`);
  }
}
