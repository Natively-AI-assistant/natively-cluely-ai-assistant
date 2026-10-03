// Did the claim pass see what it deleted? For every replaced row: the numbers the edit dropped that the answer's
// prompt states, split by whether the text the pass actually received (its recorded request) still held them.
//   node evidence-rich/report/claim-pass-cut.mjs e1 dev cf holdout
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra.
import { loadRun, funnel, readJsonl, answerOf, splitGist } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const nums = (s) => new Set((String(s).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '')));
const [tag, ...sets] = process.argv.slice(2); const R = []; let calls = 0, cut = 0; const lens = [];
for (const s of sets) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`);
  const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const D = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.draft.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) { const w = run.wire[row.benchmark_id]; const full = (w?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const pass = (w?.other_requests ?? []).find((o) => /DRAFT REPLY:/.test((o.messages ?? []).map((m) => m.text ?? '').join('\n'))); if (!pass) continue; calls++;
    const got = (pass.messages ?? []).map((m) => m.text ?? '').join('\n'); const seen = got.slice(0, got.lastIndexOf('DRAFT REPLY:')); const wasCut = full.length > 24000; if (wasCut) cut++; lens.push(full.length);
    const d = D[row.benchmark_id], s2 = S[row.benchmark_id]; if (!d || !s2) continue;
    const dn = nums(splitGist(row.raw_answer).body), en = nums(splitGist(answerOf(row)).body), fn = nums(full), sn = nums(seen);
    const dropped = [...dn].filter((n) => !en.has(n) && fn.has(n)); const unseen = dropped.filter((n) => !sn.has(n));
    R.push({ g: s2.official.overall - d.official.overall, dropped: dropped.length, unseen: unseen.length, wasCut, surface: row.surface, del: funnel(run.ds.byId[row.benchmark_id], row, run).evidence_delivered === true }); } }
lens.sort((a, b) => a - b);
console.log(`build ${tag}, sets ${sets.join('+')}: claim-pass calls ${calls}; the answer's prompt was longer than 24,000 characters on ${cut} (median length ${lens[Math.floor(lens.length / 2)]}, max ${lens.at(-1)})`);
const p = (l, xs) => console.log(`  ${l.padEnd(74)} n ${String(xs.length).padStart(3)}  shown − draft ${xs.length ? (mean(xs.map((r) => r.g)) >= 0 ? '+' : '') + mean(xs.map((r) => r.g)).toFixed(2) : '–'}${xs.length >= 5 ? ' ±' + ci95(xs.map((r) => r.g)).toFixed(2) : ''}`);
p('replaced rows (draft judged)', R); p('… the pass saw the whole prompt', R.filter((r) => !r.wasCut)); p('… the pass saw a cut prompt', R.filter((r) => r.wasCut));
p('edit dropped a number the prompt states', R.filter((r) => r.dropped)); p('… and the pass had NOT been shown that number (past the cut)', R.filter((r) => r.unseen)); p('… and the pass had been shown every dropped number', R.filter((r) => r.dropped && !r.unseen));
p('edit dropped no stated number', R.filter((r) => !r.dropped)); p('heard, cut prompt', R.filter((r) => r.wasCut && r.surface === 'hotkey')); p('typed, cut prompt', R.filter((r) => r.wasCut && r.surface === 'typed'));
