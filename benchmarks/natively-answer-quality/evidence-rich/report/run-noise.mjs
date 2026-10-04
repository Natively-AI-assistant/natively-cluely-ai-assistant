// How far apart are two runs? Paired on the same rows, split by whether the evidence in the prompt was the same.
//   node evidence-rich/report/run-noise.mjs m1 m1r dev cf        (two runs of one build: run-to-run variation)
//   node evidence-rich/report/run-noise.mjs m1 m2 dev cf         (control against candidate)
// Run from benchmarks/natively-answer-quality. ER_JUDGE=opus (default, provisional) or astra.
import { loadRun, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus'; const [tagA, tagB, ...sets] = process.argv.slice(2).filter((a) => a !== '--blind');
const ev = (u) => [...u.matchAll(/<evidence ([^>]*)>/g)].map((m) => (m[1].match(/source_name="([^"]*)"/) ?? [])[1] ?? (m[1].match(/source_type="([^"]*)"/) ?? [])[1]).sort().join('|');
const PROFILE_MODES = new Set(['looking-for-work', 'technical-interview']);
const P = []; const ttft = { a: [], b: [] };
for (const s of sets) { const A = loadRun(`evidence-rich/results/er-${s}-${tagA}`), B = loadRun(`evidence-rich/results/er-${s}-${tagB}`);
  const J = (n) => Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${n}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const JA = J(`er-${s}-${tagA}`), JB = J(`er-${s}-${tagB}`);
  for (const row of B.rows) { const ra = A.rowsById[row.benchmark_id]; const a = JA[row.benchmark_id]?.official, b = JB[row.benchmark_id]?.official; if (!ra || !a || !b) continue;
    const ua = (A.wire[row.benchmark_id]?.messages ?? []).map((m) => m.text ?? '').join('\n'), ub = (B.wire[row.benchmark_id]?.messages ?? []).map((m) => m.text ?? '').join('\n');
    P.push({ a, b, profileMode: PROFILE_MODES.has(B.ds.byId[row.benchmark_id]?.mode), same: ev(ua) === ev(ub), sameAnswer: String(ra.rendered_answer ?? ra.raw_answer).trim() === String(row.rendered_answer ?? row.raw_answer).trim() });
    if (s === 'dev' && row.surface !== 'typed') { if (Number.isFinite(ra.ttft_ms)) ttft.a.push(ra.ttft_ms); if (Number.isFinite(row.ttft_ms)) ttft.b.push(row.ttft_ms); } } }
const f2 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`; const med = (v) => { const x = [...v].sort((p, q) => p - q); return x.length ? Math.round(x[Math.floor(x.length / 2)]) : NaN; };
const line = (l, xs) => { if (!xs.length) return; const d = xs.map((p) => p.b.overall - p.a.overall); const abs = d.map(Math.abs); const sd = Math.sqrt(d.reduce((t, x) => t + (x - mean(d)) ** 2, 0) / Math.max(1, d.length - 1));
  console.log(`${l}: n ${xs.length}; ${mean(xs.map((p) => p.a.overall)).toFixed(2)} → ${mean(xs.map((p) => p.b.overall)).toFixed(2)} (${f2(mean(d))} ±${ci95(d).toFixed(2)}); per-row difference: sd ${sd.toFixed(2)}, within 0.5 on ${(100 * abs.filter((x) => x <= 0.5).length / abs.length).toFixed(0)} %, over 2 points on ${(100 * abs.filter((x) => x > 2).length / abs.length).toFixed(0)} %; hard fails ${xs.filter((p) => p.a.hard_fail).length} → ${xs.filter((p) => p.b.hard_fail).length} (newly failing ${xs.filter((p) => !p.a.hard_fail && p.b.hard_fail).length}, newly fine ${xs.filter((p) => p.a.hard_fail && !p.b.hard_fail).length}; failing in both ${xs.filter((p) => p.a.hard_fail && p.b.hard_fail).length}); critical ${xs.filter((p) => p.a.critical).length} → ${xs.filter((p) => p.b.critical).length}`); };
console.log(`${tagA} against ${tagB}, ${sets.join('+')} (judge ${JUDGE})`);
line('all rows', P); line('same evidence in the prompt', P.filter((p) => p.same)); line('different evidence in the prompt', P.filter((p) => !p.same));
line('the seven modes without a profile', P.filter((p) => !p.profileMode)); line('… of those, same evidence in the prompt', P.filter((p) => !p.profileMode && p.same)); line('the two profile modes', P.filter((p) => p.profileMode));
console.log(`identical shown answer in both runs: ${P.filter((p) => p.sameAnswer).length} of ${P.length}; heard first word, dev median: ${med(ttft.a)} → ${med(ttft.b)} ms`);
