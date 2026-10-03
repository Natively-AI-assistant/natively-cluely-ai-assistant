// Mode-specific slices of the final report (Looking for work, Technical Interview, Sales, Call Center): … mode-slices.mjs e1 dev cf holdout
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const [tag, ...sets] = process.argv.slice(2); const R = [];
for (const s of sets) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`); const J = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) { const j = J[row.benchmark_id]; if (!j) continue; const item = run.ds.byId[row.benchmark_id]; const cfg = run.ds.configsById.get(row.evidence_config); R.push({ item, row, o: j.official, fn: funnel(item, row, run), nfiles: (cfg?.files ?? []).length, src: item.oracle.source_ids ?? [] }); } }
const line = (l, xs) => { if (!xs.length) { console.log(`  ${l.padEnd(58)} n=  0`); return; } const v = xs.map((r) => r.o.overall); console.log(`  ${l.padEnd(58)} n=${String(xs.length).padStart(3)}  mean ${mean(v).toFixed(2)}${xs.length >= 5 ? ' ±' + ci95(v).toFixed(2) : ''}  hard ${xs.filter((r) => r.o.hard_fail).length}  delivered ${xs.filter((r) => r.fn.evidence_delivered === true).length}/${xs.filter((r) => r.fn.evidence_required).length}`); };
const m = (k) => R.filter((r) => r.item.mode === k);
const isPi = (s) => /^PI[-:]/.test(s); const isNotes = (s) => /INTERVIEW-NOTES|COMPANY-RESEARCH/.test(s);
console.log(`build ${tag}, sets ${sets.join('+')}: ${R.length} judged rows`);
console.log('Looking for work');
const L = m('looking-for-work');
line('answer rests on résumé / JD only', L.filter((r) => r.src.length && r.src.every(isPi)));
line('answer rests on the candidate\'s own notes (± résumé / JD)', L.filter((r) => r.src.some(isNotes)));
line('missing personal evidence (deliberately absent)', L.filter((r) => r.item.condition === 'missing_evidence'));
line('  … of which notes loaded but silent on it', L.filter((r) => r.item.condition === 'missing_evidence' && r.nfiles > 0));
line('  … of which no notes loaded', L.filter((r) => r.item.condition === 'missing_evidence' && r.nfiles === 0));
line('profile A', L.filter((r) => String(r.row.pi_state).startsWith('A'))); line('profile B', L.filter((r) => String(r.row.pi_state).startsWith('B'))); line('no profile', L.filter((r) => r.row.pi_state === 'none'));
console.log('Technical Interview');
const T = m('technical-interview');
line('generic technical / coding (no source needed)', T.filter((r) => r.item.condition === 'irrelevant_source' || (!r.src.length && r.item.condition !== 'missing_evidence')));
line('coding asks with executable tests', T.filter((r) => r.item.oracle.requires_code_validation));
line('answer rests on résumé / JD only', T.filter((r) => r.src.length && r.src.every(isPi)));
line('answer rests on project / design / code files', T.filter((r) => r.src.some((s) => /^TI-REF/.test(s))));
line('missing evidence', T.filter((r) => r.item.condition === 'missing_evidence'));
for (const [k, lab] of [['sales', 'Sales'], ['call-center', 'Call Center']]) { console.log(lab); const X = m(k);
  line('pack loaded, answer rests on it', X.filter((r) => r.nfiles > 0 && r.fn.evidence_required && r.item.condition !== 'conflict_stale'));
  line('pack loaded, conflicting / outdated sources involved', X.filter((r) => r.item.condition === 'conflict_stale'));
  line('pack loaded, the fact is absent from it', X.filter((r) => r.nfiles > 0 && r.item.condition === 'missing_evidence'));
  line('nothing loaded', X.filter((r) => r.nfiles === 0));
  line('general knowledge / present decision (files not needed)', X.filter((r) => r.item.condition === 'irrelevant_source')); }
console.log('All modes'); line('nothing loaded in the mode (every mode)', R.filter((r) => r.nfiles === 0 && r.row.pi_state === 'none')); line('calculation needed', R.filter((r) => r.item.oracle.requires_calculation)); line('heard', R.filter((r) => r.row.surface === 'hotkey')); line('typed', R.filter((r) => r.row.surface === 'typed'));
