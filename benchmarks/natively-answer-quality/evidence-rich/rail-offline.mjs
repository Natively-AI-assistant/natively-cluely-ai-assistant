#!/usr/bin/env node
// Offline evaluation of a deterministic rail on the claim pass's edit (candidate E3).
// The rail: the edit is rejected when it removes at least one number of the draft that the material states and
// brings no number the draft did not have. Deterministic given the draft, the shown text and the material (the V3
// user message), all of which a run records; so a row the rail rejects takes its DRAFT's judgment and every other
// row keeps its shown judgment. `nums` is the claim verifier's own (electron/llm/claimVerifier.ts).
//   node evidence-rich/rail-offline.mjs --runs evidence-rich/results/er-dev-e1[,…] --set base [--judge opus] [--blind]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, funnel, readJsonl, answerOf, splitGist } from './objective.mjs';
import { mean, ci95 } from './judge/score-er.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const judge = opt('judge', 'opus'), set = opt('set', 'base'), blind = !!opt('blind');
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const nums = (s) => new Set((String(s).match(NUM_RE) ?? []).map((n) => n.replace(/,/g, '')));
export function railRejects(draftBody, editedBody, material) {
  const d = nums(draftBody), e = nums(editedBody), m = nums(material);
  const removedSupported = [...d].some((n) => !e.has(n) && m.has(n));
  const addedAny = [...e].some((n) => !d.has(n));
  return removedSupported && !addedAny;
}
const rows = [];
for (const r of String(opt('runs')).split(',')) {
  const dir = path.resolve(HERE, '..', r); const run = loadRun(dir); const name = path.basename(dir);
  const S = Object.fromEntries(readJsonl(path.join(HERE, 'judge', 'out', set, `${name}.${judge}.jsonl`)).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  const D = Object.fromEntries(readJsonl(path.join(HERE, 'judge', 'out', set, `${name}.draft.${judge}.jsonl`)).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) {
    const s = S[row.benchmark_id]; if (!s) continue; const item = run.ds.byId[row.benchmark_id]; const fn = funnel(item, row, run);
    const replaced = !!row.answer_differs_raw_vs_rendered; const d = D[row.benchmark_id];
    let flip = false;
    if (replaced && d) { const material = (run.wire[row.benchmark_id]?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n'); flip = railRejects(splitGist(row.raw_answer).body, splitGist(answerOf(row)).body, material); }
    rows.push({ id: row.benchmark_id, item, fn, replaced, judgedDraft: !!d, flip, shown: s.official, draft: d?.official ?? null, with: flip ? d.official : s.official, row });
  }
}
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const flipped = rows.filter((r) => r.flip);
const gain = flipped.map((r) => r.draft.overall - r.shown.overall);
console.log(`rows ${rows.length}; shown text replaced ${rows.filter((r) => r.replaced).length} (drafts judged ${rows.filter((r) => r.replaced && r.judgedDraft).length}); the rail rejects the edit on ${flipped.length}`);
if (flipped.length) {
  console.log(`flipped rows: shown ${mean(flipped.map((r) => r.shown.overall)).toFixed(2)} → draft ${mean(flipped.map((r) => r.draft.overall)).toFixed(2)}, gain ${f2(mean(gain))} ±${(ci95(gain) ?? 0).toFixed(2)}; better by more than 0.5: ${gain.filter((g) => g > 0.5).length}, worse by more than 0.5: ${gain.filter((g) => g < -0.5).length}; hard fails ${flipped.filter((r) => r.shown.hard_fail).length} → ${flipped.filter((r) => r.draft.hard_fail).length}`);
  const nodoc = flipped.filter((r) => ['missing_evidence', 'irrelevant_source'].includes(r.item.condition)); const g2 = nodoc.map((r) => r.draft.overall - r.shown.overall);
  console.log(`flipped rows that need no document: ${nodoc.length}${nodoc.length ? `, change ${f2(mean(g2))}, hard fails ${nodoc.filter((r) => r.shown.hard_fail).length} → ${nodoc.filter((r) => r.draft.hard_fail).length}` : ''}`);
  const del = flipped.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered); const g3 = del.map((r) => r.draft.overall - r.shown.overall);
  console.log(`flipped rows with the evidence in the prompt: ${del.length}${del.length ? `, gain ${f2(mean(g3))}` : ''}`);
}
const not = rows.filter((r) => r.replaced && r.judgedDraft && !r.flip); const gn = not.map((r) => r.draft.overall - r.shown.overall);
console.log(`replaced rows the rail leaves alone: ${not.length}, draft − shown ${not.length ? f2(mean(gn)) : '–'} (the edit helped where this is negative)`);
const all = rows.map((r) => r.with.overall - r.shown.overall);
console.log(`all rows: ${mean(rows.map((r) => r.shown.overall)).toFixed(2)} → ${mean(rows.map((r) => r.with.overall)).toFixed(2)} (${f2(mean(all))} ±${(ci95(all) ?? 0).toFixed(2)}); hard fails ${rows.filter((r) => r.shown.hard_fail).length} → ${rows.filter((r) => r.with.hard_fail).length}; critical ${rows.filter((r) => r.shown.critical).length} → ${rows.filter((r) => r.with.critical).length}`);
const delAll = rows.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered); const v = delAll.map((r) => r.with.overall).sort((a, b) => a - b);
console.log(`with the rail, rows with the evidence in the prompt: n ${delAll.length}, mean ${mean(v).toFixed(2)}, p10 ${v.length ? v[Math.floor(v.length * 0.1)].toFixed(1) : '–'}, hard fails ${delAll.filter((r) => r.with.hard_fail).length}, critical ${delAll.filter((r) => r.with.critical).length}`);
if (!blind) for (const r of flipped.sort((a, b) => (a.draft.overall - a.shown.overall) - (b.draft.overall - b.shown.overall)).slice(0, 6)) console.log(`  least helped: ${r.id} [${r.item.condition}] shown ${r.shown.overall.toFixed(1)} draft ${r.draft.overall.toFixed(1)} | draft: ${splitGist(r.row.raw_answer).body.replace(/\s+/g, ' ').slice(0, 150)}`);
