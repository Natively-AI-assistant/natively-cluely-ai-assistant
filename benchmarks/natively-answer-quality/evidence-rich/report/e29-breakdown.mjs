#!/usr/bin/env node
// E29: the differing rows of one repetition, split by which arm's pass edited the draft. Aggregates only.
//   node evidence-rich/report/e29-breakdown.mjs [--plan evidence-rich/results/replay/astra-plan-e29.json] [--k 0]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loadRun, objective } from '../objective.mjs'; import { officialScore, mean } from '../judge/score-er.mjs';
const ER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const plan = JSON.parse(fs.readFileSync(path.resolve(opt('plan', path.join(ER, 'results/replay/astra-plan-e29.json'))), 'utf8')); const K = Number(opt('k', 0));
const [armA, armB] = plan.arms.map((a) => a.replace(/@\d+$/, ''));
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const outcome = (arm) => new Map(lines(path.join(ER, 'results/replay', `${arm}.jsonl`)).filter((r) => r.k === K).map((r) => [`${r.run}|${r.id}`, r.changed]));
const oa = outcome(armA), ob = outcome(armB);
const jcache = new Map(); const judged = (name) => { if (!jcache.has(name)) { const m = new Map(); for (const j of lines(path.join(ER, 'judge/out/base', `${name}.astra.jsonl`))) if (j.ok && j.judge_model === 'gpt-6-astra') m.set(j.benchmark_id, j); jcache.set(name, m); } return jcache.get(name); };
const rcache = new Map(); const run = (name) => { if (!rcache.has(name)) rcache.set(name, loadRun(path.join(ER, 'results', name))); return rcache.get(name); };
const src = (p, s, arm) => (s === 'new' ? `rp-${plan.arms[arm === armA ? 0 : 1]}--${p.run}` : s === 'draft' ? `${p.run}.draft` : p.run);
const INV = /^(unsupported_|fabricated_)/; const rows = [];
for (const p of plan.pairs) {
  const item = run(p.run).ds.byId[p.id]; const base = run(p.run).rows.find((r) => r.benchmark_id === p.id);
  const one = (s, arm) => { const name = src(p, s, arm); const j = judged(name).get(p.id); if (!j) return null;
    const row = s === 'new' ? run(name).rows.find((r) => r.benchmark_id === p.id) : s === 'draft' ? { ...base, answer: base.draft_answer ?? base.draft ?? base.answer } : base;
    const off = officialScore(j.judgment, item.mode, objective(item, row)); return { overall: off.overall, hard: !!off.hard_fail, inv: (off.flags ?? []).some((f) => INV.test(f)) }; };
  const a = one(p.sa, armA), b = one(p.sb, armB); if (!a || !b) continue;
  const ea = !!oa.get(`${p.run}|${p.id}`), eb = !!ob.get(`${p.run}|${p.id}`);
  rows.push({ a, b, cat: ea && eb ? 'both passes edited (different text)' : ea ? `only ${armA} edited` : eb ? `only ${armB} edited` : 'neither edited' });
}
const line = (label, xs) => console.log(`${label.padEnd(40)} n ${String(xs.length).padStart(2)} | ${armA} ${mean(xs.map((x) => x.a.overall)).toFixed(3)} → ${armB} ${mean(xs.map((x) => x.b.overall)).toFixed(3)} | hard ${xs.filter((x) => x.a.hard).length} → ${xs.filter((x) => x.b.hard).length} | invention-flag rows ${xs.filter((x) => x.a.inv).length} → ${xs.filter((x) => x.b.inv).length} | better ${xs.filter((x) => x.b.overall - x.a.overall > 0.25).length}, worse ${xs.filter((x) => x.b.overall - x.a.overall < -0.25).length}`);
console.log(`repetition ${K}, ${rows.length} of ${plan.pairs.length} pairs judged on both sides`); line('ALL', rows);
for (const c of [...new Set(rows.map((r) => r.cat))].sort()) line(c, rows.filter((r) => r.cat === c));
