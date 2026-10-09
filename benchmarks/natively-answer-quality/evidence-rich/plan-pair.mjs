#!/usr/bin/env node
// Which judgments a paired comparison of two replay arms still needs, for the rows where the arms show different text.
//   node evidence-rich/plan-pair.mjs --a <arm[@k]> --b <arm[@k]> --runs evidence-rich/results/<run>,… --out <plan.json>
// A text equal to the draft uses the draft's judgment (the run's own judgment when the app did not edit the row), a
// text equal to what the app showed uses that one, any other text is judged in the derived run rp-<arm>--<run>
// (replay-judge.mjs prep makes it). Prints counts only, so it is safe on the blind holdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, readJsonl, answerOf, splitGist } from './objective.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const body = (t) => splitGist(t).body.replace(/\s+/g, ' ').trim();
// An arm name may carry a repetition, as in replay-judge.mjs: "e19h@1" is repetition 1, judged in rp-e19h-k1--<run>.
const splitK = (name) => { const m = String(name).match(/^(.*)@(\d+)$/); return m ? { base: m[1], k: Number(m[2]) } : { base: String(name), k: 0 }; };
const tagOf = (name) => { const { base, k } = splitK(name); return k ? `${base}-k${k}` : base; };
const arm = (name) => { const { base, k } = splitK(name); const m = {}; for (const r of readJsonl(path.join(HERE, 'results', 'replay', `${base}.jsonl`))) if (r.k === k) m[`${r.run}|${r.id}`] = r; return m; };
const done = (file) => new Set(readJsonl(path.join(HERE, 'judge', 'out', 'base', `${file}.astra.jsonl`)).filter((j) => j.ok).map((j) => j.benchmark_id));
const given = [opt('a'), opt('b')]; const arms = given.map(arm); const names = given.map(tagOf); const need = {}; const pairs = []; const want = (k, id) => { (need[k] ??= []).includes(id) || need[k].push(id); };
for (const r of String(opt('runs')).split(',')) {
  const dir = path.resolve(HERE, '..', r); const run = loadRun(dir); const runName = path.basename(dir);
  for (const row of run.rows) {
    const recs = arms.map((A) => A[`${runName}|${row.benchmark_id}`]); if (recs.some((x) => !x)) continue;
    if (body(recs[0].text) === body(recs[1].text)) continue;
    const src = recs.map((rec) => (!rec.changed || body(rec.text) === body(row.raw_answer) ? (row.answer_differs_raw_vs_rendered ? 'draft' : 'shown') : row.answer_differs_raw_vs_rendered && body(rec.text) === body(answerOf(row)) ? 'shown' : 'new'));
    src.forEach((s, i) => want(s === 'new' ? `rp-${names[i]}--${runName}` : s === 'draft' ? `${runName}::draft` : runName, row.benchmark_id));
    pairs.push({ run: runName, id: row.benchmark_id, sa: src[0], sb: src[1] });
  }
}
const todo = Object.fromEntries(Object.entries(need).map(([k, ids]) => { const d = done(k.replace('::draft', '.draft')); return [k, ids.filter((id) => !d.has(id))]; }));
fs.writeFileSync(path.resolve(opt('out')), JSON.stringify({ arms: names, need, pairs }));
console.log(`${names[0]} against ${names[1]}: ${pairs.length} rows differ; judgments needed ${Object.values(need).flat().length}, still to do ${Object.values(todo).flat().length} ${JSON.stringify(Object.fromEntries(Object.entries(todo).map(([k, v]) => [k, v.length])))}`);
