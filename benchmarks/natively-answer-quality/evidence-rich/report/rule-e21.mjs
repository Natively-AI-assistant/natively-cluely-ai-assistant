#!/usr/bin/env node
// E21a: the calculation notice on calculation questions that do not get it today. Judge-free, generator replay.
//   node evidence-rich/report/rule-e21.mjs select <run>[,<run>]            prints the ids (calculation oracle, no "# Calculation" in the recorded prompt)
//   node evidence-rich/report/rule-e21.mjs read --base e21-base --arms e21-n1,e21-n2
// A sample is RIGHT when the deterministic calculation check finds the oracle's result in the shown text
// (objective.mjs: the number within tolerance when it is distinctive, or one of the accepted forms).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective } from '../objective.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ER = path.join(HERE, '..');
const args = process.argv.slice(2); const cmd = args[0]; const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const items = new Map(); for (const p of ['dev', 'dev2']) for (const it of JSON.parse(fs.readFileSync(path.join(ER, 'datasets', `${p}.json`), 'utf8')).items) items.set(it.id, it);
if (cmd === 'select') {
  const ids = [];
  for (const r of String(args[1]).split(',')) { const run = loadRun(path.join(ER, 'results', r)); for (const row of run.rows) { const it = run.ds.byId[row.benchmark_id]; const w = run.wire[row.benchmark_id]; if (!it?.oracle?.requires_calculation || !it.oracle.calculation_oracle || !w) continue; const user = (w.messages ?? []).map((m) => m.text ?? '').join('\n'); if (!/# Calculation\n/.test(user)) ids.push(row.benchmark_id); } }
  console.log(ids.join(','));
} else {
  const right = (j) => { const it = items.get(j.id); const o = objective(it, { raw_answer: j.text, rendered_answer: null, pi_state: 'none' }); return o.checks.some((c) => c.label === 'calculation result stated' && c.ok); };
  const load = (arm) => { const m = new Map(); for (const j of lines(path.join(ER, 'results', 'replay', `gen-${arm}.jsonl`))) { if (j.err) continue; const a = m.get(j.id) ?? []; a.push({ right: right(j), forbidden: (j.forbidden ?? []).length > 0, ms_visible: j.ms_visible, ms_first: j.ms_first, block: !!j.calc_block, k: j.k }); m.set(j.id, a); } return m; };
  const q = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const base = load(opt('base'));
  const rate = (m, ids) => { let r = 0, n = 0; for (const id of ids) for (const s of m.get(id) ?? []) { n++; if (s.right) r++; } return { right: r, n, pct: n ? +(100 * r / n).toFixed(1) : null }; };
  for (const arm of String(opt('arms')).split(',')) {
    const cand = load(arm); const ids = [...base.keys()].filter((id) => cand.has(id));
    const b = rate(base, ids), c = rate(cand, ids);
    // paired bootstrap over rows of the difference in each row's share of right samples
    const d = ids.map((id) => cand.get(id).filter((s) => s.right).length / cand.get(id).length - base.get(id).filter((s) => s.right).length / base.get(id).length);
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const boots = Array.from({ length: 4000 }, () => { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)]; return 100 * s / d.length; }).sort((x, y) => x - y);
    const mean = 100 * d.reduce((a, x) => a + x, 0) / Math.max(1, d.length);
    const fell = ids.filter((id) => base.get(id).filter((s) => s.right).length >= 3 && cand.get(id).filter((s) => s.right).length <= 1);
    const rose = ids.filter((id) => base.get(id).filter((s) => s.right).length <= 1 && cand.get(id).filter((s) => s.right).length >= 3);
    const vis = (m) => ids.flatMap((id) => m.get(id).map((s) => s.ms_visible)); const forb = (m) => ids.reduce((n, id) => n + m.get(id).filter((s) => s.forbidden).length, 0);
    const blocks = ids.reduce((n, id) => n + cand.get(id).filter((s) => s.block).length, 0);
    const L1 = c.pct - b.pct >= 8 && boots[Math.floor(0.025 * boots.length)] > 0; const L2 = fell.length <= 2;
    const dv50 = q(vis(cand), 0.5) - q(vis(base), 0.5), dv90 = q(vis(cand), 0.9) - q(vis(base), 0.9); const L3 = dv50 <= 500 && dv90 <= 900; const L4 = forb(cand) <= forb(base) + 2;
    console.log(`\narm ${arm} against ${opt('base')}: ${ids.length} rows`);
    console.log(`  right samples: ${b.right}/${b.n} (${b.pct} %) -> ${c.right}/${c.n} (${c.pct} %); paired change ${mean.toFixed(1)} points, 95 % interval ${boots[Math.floor(0.025 * boots.length)].toFixed(1)} to ${boots[Math.floor(0.975 * boots.length)].toFixed(1)}`);
    console.log(`  rows that rose (<=1 right -> >=3 right): ${rose.length}${rose.length ? ' ' + rose.join(' ') : ''}`);
    console.log(`  rows that fell (>=3 right -> <=1 right): ${fell.length}${fell.length ? ' ' + fell.join(' ') : ''}`);
    console.log(`  first visible character: median ${q(vis(base), 0.5)} -> ${q(vis(cand), 0.5)} ms (${dv50 >= 0 ? '+' : ''}${dv50}), p90 ${q(vis(base), 0.9)} -> ${q(vis(cand), 0.9)} ms (${dv90 >= 0 ? '+' : ''}${dv90}); samples that wrote a block: ${blocks}/${c.n}`);
    console.log(`  samples with a forbidden string: ${forb(base)} -> ${forb(cand)}`);
    console.log(`  line 1 (>= +8 points, interval above 0): ${L1 ? 'holds' : 'FAILS'} | line 2 (fell <= 2): ${L2 ? 'holds' : 'FAILS'} | line 3 (visible +500 / +900 ms): ${L3 ? 'holds' : 'FAILS'} | line 4 (forbidden <= base + 2): ${L4 ? 'holds' : 'FAILS'}  => ${L1 && L2 && L3 && L4 ? 'ALL HOLD' : 'NOT KEPT'}`);
  }
}
