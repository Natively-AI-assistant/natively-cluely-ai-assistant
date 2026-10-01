#!/usr/bin/env node
// scripts/embedding-crosslang-analyse.mjs
//
// Paired analysis of the cross-language tracks (embedding-crosslang-prepare.mjs,
// embedding-benchmark/queries/crosslang_*.json), from the retrieval bench's
// result files results/raw-retrieval/<model>__<tag>.json:
//
//   hi2en       Hindi question  → English corpus (chunk-level ground truth)
//   hi2en-ctl   the same 120 questions in English (the control)
//   en2hi       English question → six documents replaced by Hindi (file-level)
//   en2hi-ctl   the same questions, documents left in English (the control)
//
// For each model: the per-question cost of crossing languages (track minus its
// control), and model-vs-model deltas on the Hindi tracks. Paired bootstrap,
// 2000 replicates, fixed seed; an interval spanning zero is "within noise".
// hi2en is also split by script: questions that carry a Latin identifier
// (env var, column, error code) can be matched on that token alone, so the
// pure-Hindi subset is the real test of cross-language semantics.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(REPO, 'results', 'raw-retrieval');
const MODELS = (process.env.MODELS || 'minilm-baseline,multilingual-e5-small,multilingual-e5-base,e5-small-v2').split(',');
const PAIRS = [['hi2en', 'hi2en-ctl'], ['en2hi', 'en2hi-ctl']];

const hiQueries = JSON.parse(fs.readFileSync(path.join(REPO, 'embedding-benchmark/queries/crosslang_hi_to_en.json'), 'utf8'));
const LATIN_TOKEN = /[A-Za-z_][A-Za-z0-9_:/.-]{3,}/;
const mixedScript = new Set(hiQueries.filter((q) => LATIN_TOKEN.test(q.text)).map((q) => q.source_query_id));

const load = (model, tag) => {
  const f = path.join(RAW, `${model}__${tag}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const srcId = (qid) => qid.replace(/-(hi|en)$/, '');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pick = { r1: (r) => r.base.r1, r5: (r) => r.base.r5, r10: (r) => r.base.r10, mrr: (r) => r.base.mrr, rr10: (r) => r.reranked?.r10 ?? 0 };

let seed = 0x2545f491;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
function paired(a, b, fn, filter = () => true) {
  const bm = new Map(b.perQuery.map((q) => [srcId(q.query_id), fn(q)]));
  const d = a.perQuery.filter((q) => bm.has(srcId(q.query_id)) && filter(srcId(q.query_id))).map((q) => fn(q) - bm.get(srcId(q.query_id)));
  if (!d.length) return null;
  const reps = [];
  for (let i = 0; i < 2000; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[(rnd() * d.length) | 0]; reps.push(s / d.length); }
  reps.sort((x, y) => x - y);
  const lo = reps[50], hi = reps[1949];
  return { n: d.length, delta: +mean(d).toFixed(4), ci: [+lo.toFixed(4), +hi.toFixed(4)], verdict: lo > 0 ? 'better' : hi < 0 ? 'worse' : 'noise' };
}
const fmt = (p) => (p ? `${p.delta >= 0 ? '+' : ''}${p.delta.toFixed(4)} [${p.ci[0].toFixed(3)}, ${p.ci[1].toFixed(3)}] ${p.verdict}` : 'n/a');

const out = { generatedAt: new Date().toISOString(), mixedScriptQuestions: mixedScript.size, pureHindiQuestions: hiQueries.length - mixedScript.size, models: {} };
console.log(`hi2en: ${hiQueries.length} questions, ${mixedScript.size} carry a Latin identifier, ${hiQueries.length - mixedScript.size} are pure Hindi\n`);

for (const model of MODELS) {
  const m = {};
  for (const tag of ['hi2en', 'hi2en-ctl', 'en2hi', 'en2hi-ctl']) {
    const r = load(model, tag);
    if (r) m[tag] = { n: r.perQuery.length, r1: r.overall.r1, r5: r.overall.r5, r10: r.overall.r10, mrr: r.overall.mrr, reranked_r10: r.reranked?.r10 ?? null, _raw: r };
  }
  if (!Object.keys(m).length) continue;
  console.log(`== ${model}`);
  for (const [tag, v] of Object.entries(m)) console.log(`   ${tag.padEnd(10)} n=${v.n}  R@1=${v.r1.toFixed(4)}  R@5=${v.r5.toFixed(4)}  R@10=${v.r10.toFixed(4)}  MRR=${v.mrr.toFixed(4)}  reranked R@10=${v.reranked_r10 ?? 'n/a'}`);
  m.crossingCost = {};
  for (const [t, c] of PAIRS) {
    if (!m[t] || !m[c]) continue;
    m.crossingCost[t] = {
      r10: paired(m[t]._raw, m[c]._raw, pick.r10), mrr: paired(m[t]._raw, m[c]._raw, pick.mrr), rerankedR10: paired(m[t]._raw, m[c]._raw, pick.rr10),
      ...(t === 'hi2en' ? {
        pureHindiR10: paired(m[t]._raw, m[c]._raw, pick.r10, (id) => !mixedScript.has(id)),
        mixedScriptR10: paired(m[t]._raw, m[c]._raw, pick.r10, (id) => mixedScript.has(id)),
      } : {}),
    };
    for (const [k, v] of Object.entries(m.crossingCost[t])) console.log(`   cost ${t} ${k.padEnd(15)} ${fmt(v)}`);
  }
  out.models[model] = m;
}

// Model vs model on the Hindi tracks.
out.headToHead = {};
for (const tag of ['hi2en', 'en2hi']) {
  for (const base of ['minilm-baseline', 'multilingual-e5-base']) {
    const b = out.models[base]?.[tag]?._raw; if (!b) continue;
    for (const model of MODELS) {
      if (model === base) continue;
      const a = out.models[model]?.[tag]?._raw; if (!a) continue;
      const key = `${tag}: ${model} vs ${base}`;
      out.headToHead[key] = {
        r10: paired(a, b, pick.r10), mrr: paired(a, b, pick.mrr), rerankedR10: paired(a, b, pick.rr10),
        ...(tag === 'hi2en' ? { pureHindiR10: paired(a, b, pick.r10, (id) => !mixedScript.has(id)) } : {}),
      };
      console.log(`\n${key}`);
      for (const [k, v] of Object.entries(out.headToHead[key])) console.log(`   ${k.padEnd(13)} ${fmt(v)}`);
    }
  }
}

for (const m of Object.values(out.models)) for (const v of Object.values(m)) if (v && v._raw) delete v._raw;
fs.mkdirSync(path.join(REPO, 'results', 'crosslang'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'results', 'crosslang', 'comparison.json'), JSON.stringify(out, null, 1));
