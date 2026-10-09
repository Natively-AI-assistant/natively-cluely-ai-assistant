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
const QUANT_CODE_RE = /\b(?:complexity|big[- ]?o|O\(|algorithm|code|function|implement|array|linked list|recursion|runtime|sql|query|regex|leetcode)\b/i;
const userOf = (w) => (w.messages ?? []).map((m) => m.text ?? '').join('\n');
if (cmd === 'select2a' || cmd === 'select2b') {
  // 2a: no notice in the recorded prompt, no calculation oracle, an evidence section present, not a code question
  //     (the rows an evidence-based trigger would newly reach although they need no calculation).
  // 2b: rows whose recorded prompt carries main's notice.
  const ids = [];
  for (const r of String(args[1]).split(',')) { const run = loadRun(path.join(ER, 'results', r)); for (const row of run.rows) { const it = run.ds.byId[row.benchmark_id]; const w = run.wire[row.benchmark_id]; if (!it || !w) continue; const user = userOf(w); const has = /# Calculation\n/.test(user);
    if (cmd === 'select2b') { if (has) ids.push(row.benchmark_id); continue; }
    if (has || (it.oracle?.requires_calculation && it.oracle.calculation_oracle) || !/# Evidence \(untrusted data/.test(user) || QUANT_CODE_RE.test(String(row.question ?? ''))) continue; ids.push(row.benchmark_id); } }
  console.log(ids.join(','));
} else if (cmd === 'read2') {
  const allReq = (j) => j.required > 0 ? j.all_required : null;
  const right = (j) => { const it = items.get(j.id); if (!it?.oracle?.requires_calculation || !it.oracle.calculation_oracle) return null; const o = objective(it, { raw_answer: j.text, rendered_answer: null, pi_state: 'none' }); return o.checks.some((c) => c.label === 'calculation result stated' && c.ok); };
  const load = (arm) => lines(path.join(ER, 'results', 'replay', `gen-${arm}.jsonl`)).filter((j) => !j.err);
  const q = (a, p) => { const s2 = a.filter((x) => x != null).sort((x, y) => x - y); return s2.length ? s2[Math.min(s2.length - 1, Math.floor(p * s2.length))] : null; };
  const pct = (a) => { const v = a.filter((x) => x !== null); return v.length ? { n: v.length, pct: +(100 * v.filter(Boolean).length / v.length).toFixed(1) } : { n: 0, pct: null }; };
  const pairedLow = (A, B, f) => { const by = (L) => { const m = new Map(); for (const j of L) { const v = f(j); if (v === null) continue; const a = m.get(j.id) ?? []; a.push(v ? 1 : 0); m.set(j.id, a); } return m; }; const a = by(A), b = by(B); const d = [...a.keys()].filter((id) => b.has(id)).map((id) => b.get(id).reduce((x, y) => x + y, 0) / b.get(id).length - a.get(id).reduce((x, y) => x + y, 0) / a.get(id).length); if (!d.length) return null; let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; const boots = Array.from({ length: 4000 }, () => { let t = 0; for (let i = 0; i < d.length; i++) t += d[Math.floor(rnd() * d.length)]; return 100 * t / d.length; }).sort((x, y) => x - y); return { mean: +(100 * d.reduce((x, y) => x + y, 0) / d.length).toFixed(1), lo: +boots[Math.floor(0.025 * boots.length)].toFixed(1), hi: +boots[Math.floor(0.975 * boots.length)].toFixed(1), rows: d.length }; };
  const part = (label, baseArm, candArm, isB) => {
    const A = load(baseArm), Bc = load(candArm); const ra = pct(A.map(allReq)), rb = pct(Bc.map(allReq)); const pl = pairedLow(A, Bc, allReq);
    const fa = A.filter((j) => (j.forbidden ?? []).length).length, fb = Bc.filter((j) => (j.forbidden ?? []).length).length;
    const dv50 = q(Bc.map((j) => j.ms_visible), 0.5) - q(A.map((j) => j.ms_visible), 0.5), dv90 = q(Bc.map((j) => j.ms_visible), 0.9) - q(A.map((j) => j.ms_visible), 0.9);
    const blocksA = A.filter((j) => j.calc_block).length, blocksB = Bc.filter((j) => j.calc_block).length; const la = q(A.map((j) => j.shown_chars), 0.5), lb = q(Bc.map((j) => j.shown_chars), 0.5);
    console.log(`\n${label}: ${baseArm} (${A.length} samples, ${new Set(A.map((j) => j.id)).size} rows) -> ${candArm} (${Bc.length} samples)`);
    console.log(`  samples with every required string: ${ra.pct} % of ${ra.n} -> ${rb.pct} % of ${rb.n}; paired change ${pl?.mean} points (95 % ${pl?.lo} to ${pl?.hi}, ${pl?.rows} rows)`);
    console.log(`  forbidden-string samples: ${fa} -> ${fb}`);
    console.log(`  first visible character: median ${q(A.map((j) => j.ms_visible), 0.5)} -> ${q(Bc.map((j) => j.ms_visible), 0.5)} ms (${dv50 >= 0 ? '+' : ''}${dv50}), p90 ${q(A.map((j) => j.ms_visible), 0.9)} -> ${q(Bc.map((j) => j.ms_visible), 0.9)} ms (${dv90 >= 0 ? '+' : ''}${dv90})`);
    console.log(`  samples that wrote a block: ${blocksA}/${A.length} -> ${blocksB}/${Bc.length} (${(100 * blocksB / Math.max(1, Bc.length)).toFixed(1)} %); median shown length ${la} -> ${lb} chars (${(100 * (lb - la) / la).toFixed(1)} %)`);
    if (!isB) {
      const L1 = rb.pct >= ra.pct - 1.5 && pl.lo > -4, L2 = fb <= fa + 3, L3 = dv50 <= 150 && dv90 <= 400, L4 = blocksB / Bc.length <= 0.20, L5 = Math.abs(lb - la) / la <= 0.10;
      console.log(`  line 1 (required strings not lower by 1.5, interval above -4): ${L1 ? 'holds' : 'FAILS'} | line 2 (forbidden <= base + 3): ${L2 ? 'holds' : 'FAILS'} | line 3 (visible +150 / +400 ms): ${L3 ? 'holds' : 'FAILS'} | line 4 (block on <= 20 %): ${L4 ? 'holds' : 'FAILS'} | line 5 (length within 10 %): ${L5 ? 'holds' : 'FAILS'}  => ${L1 && L2 && L3 && L4 && L5 ? 'PART A HOLDS' : 'PART A FAILS'}`);
    } else {
      const ca = pct(A.map(right)), cb = pct(Bc.map(right)); const L6 = cb.pct >= ca.pct - 2, L7 = rb.pct >= ra.pct - 1.5, L8 = dv50 <= 100;
      console.log(`  calculation rows, right samples: ${ca.pct} % of ${ca.n} -> ${cb.pct} % of ${cb.n}`);
      console.log(`  line 6 (right not lower by 2): ${L6 ? 'holds' : 'FAILS'} | line 7 (required strings not lower by 1.5): ${L7 ? 'holds' : 'FAILS'} | line 8 (visible median +100 ms): ${L8 ? 'holds' : 'FAILS'}  => ${L6 && L7 && L8 ? 'PART B HOLDS' : 'PART B FAILS'}`);
    }
  };
  part('2a, turns with documents that need no calculation', 'e21b-base', 'e21b-n2', false);
  part('2b, turns that already carry the notice (wording swap)', 'e21c-n1', 'e21c-n2', true);
} else if (cmd === 'select') {
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
