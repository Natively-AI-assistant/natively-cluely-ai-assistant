// A candidate stack against a control build, split into what the generator wrote (the drafts) and what the claim
// pass then did: node evidence-rich/report/stack-vs.mjs e1 s2 dev cf [--blind]
// "Draft" = the streamed answer before the claim pass (the shown answer where the pass changed nothing).
// Run from benchmarks/natively-answer-quality. ER_JUDGE=opus (default, provisional) or astra; never pooled.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const argv = process.argv.slice(2).filter((a) => a !== '--blind'); const [tagA, tagB, ...sets] = argv;
const load = (tag) => { const m = {}; let labelled = 0, rows = 0; for (const s of sets) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`);
  const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const D = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.draft.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) { const s2 = S[row.benchmark_id]; if (!s2) continue; const replaced = !!row.answer_differs_raw_vs_rendered; const d = replaced ? D[row.benchmark_id] : s2; const item = run.ds.byId[row.benchmark_id];
    const user = (run.wire[row.benchmark_id]?.messages ?? []).map((x) => x.text ?? '').join('\n'); rows++; if (/ dated="| version="/.test(user)) labelled++;
    m[`${s}|${row.benchmark_id}`] = { item, row, shown: s2.official, draft: d?.official ?? null, replaced, fn: funnel(item, row, run) }; } }
  return { m, labelled, rows }; };
const A = load(tagA), B = load(tagB); const P = Object.keys(A.m).filter((k) => B.m[k]).map((k) => ({ a: A.m[k], b: B.m[k] }));
const missing = P.filter((p) => !p.a.draft || !p.b.draft).length; const Q = P.filter((p) => p.a.draft && p.b.draft);
const f2 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
console.log(`${tagA} → ${tagB}, sets ${sets.join('+')}: ${P.length} paired rows (judge ${JUDGE})${missing ? `; ${missing} left out of the draft lines (a draft not judged yet)` : ''}`);
console.log(`prompts carrying a dated/version label: ${tagA} ${A.labelled}/${A.rows}, ${tagB} ${B.labelled}/${B.rows}`);
const line = (l, xs, pick) => { if (!xs.length) return; const d = xs.map((p) => pick(p.b).overall - pick(p.a).overall); console.log(`  ${l.padEnd(52)} n ${String(xs.length).padStart(3)}  ${mean(xs.map((p) => pick(p.a).overall)).toFixed(2)} → ${mean(xs.map((p) => pick(p.b).overall)).toFixed(2)}  ${f2(mean(d))}${xs.length >= 5 ? ' ±' + ci95(d).toFixed(2) : ''}  hard fails ${xs.filter((p) => pick(p.a).hard_fail).length} → ${xs.filter((p) => pick(p.b).hard_fail).length}  critical ${xs.filter((p) => pick(p.a).critical).length} → ${xs.filter((p) => pick(p.b).critical).length}  stale/draft preferred ${xs.filter((p) => (pick(p.a).flags ?? []).some((f) => /stale|draft_source/.test(f))).length} → ${xs.filter((p) => (pick(p.b).flags ?? []).some((f) => /stale|draft_source/.test(f))).length}`); };
const cond = (...c) => (p) => c.includes(p.a.item.condition);
for (const [title, pick, rows] of [['DRAFTS (what the generator wrote)', (x) => x.draft, Q], ['SHOWN (after the claim pass)', (x) => x.shown, P]]) { console.log(title);
  line('all rows', rows, pick); line('conflict / stale', rows.filter(cond('conflict_stale')), pick); line('need no document (missing + irrelevant)', rows.filter(cond('missing_evidence', 'irrelevant_source')), pick); line('single source', rows.filter(cond('grounded_single')), pick); line('multi source', rows.filter(cond('multi_source')), pick); line('evidence required', rows.filter((p) => p.a.fn.evidence_required), pick); }
for (const [tag, X] of [[tagA, 'a'], [tagB, 'b']]) { const e = Q.map((p) => p[X].shown.overall - p[X].draft.overall); console.log(`effect of the claim pass in ${tag}: ${f2(mean(e))} ±${ci95(e).toFixed(2)}; replaced ${Q.filter((p) => p[X].replaced).length}; hard fails drafts ${Q.filter((p) => p[X].draft.hard_fail).length} → shown ${Q.filter((p) => p[X].shown.hard_fail).length}`); }
const med = (v) => { const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
for (const [tag, X] of [[tagA, 'a'], [tagB, 'b']]) { const dev = P.filter((p) => p[X].row.partition === 'dev' || sets.length === 1); const settle = dev.map((p) => p[X].row.final_event_ms - p[X].row.last_token_ms).filter((x) => x > 0); console.log(`${tag}: first word median ${Math.round(med(dev.map((p) => p[X].row.ttft_ms)))} ms; last token → settled, median ${Math.round(med(settle))} ms (n ${settle.length}); input tokens median ${Math.round(med(dev.map((p) => p[X].row.input_tokens)))}`); }
