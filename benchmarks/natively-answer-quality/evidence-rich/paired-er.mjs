#!/usr/bin/env node
// Paired comparison of two judged runs of the SAME cases (same ids): B minus A, by evidence delivery in A.
//   node evidence-rich/paired-er.mjs --a evidence-rich/results/<runA> --b evidence-rich/results/<runB> --set <set> [--judge opus] [--a-tag draft]
// --a-tag / --b-tag: read `<run>.<tag>.<judge>.jsonl` instead (e.g. the drafts file) — then A and B may be the same run.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, funnel, readJsonl } from './objective.mjs';
import { mean, ci95 } from './judge/score-er.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const judge = opt('judge', 'opus'); const set = opt('set');
const load = (r, tag) => { const dir = path.resolve(HERE, '..', r); const run = loadRun(dir); const jf = path.join(HERE, 'judge', 'out', set, `${path.basename(dir)}${tag ? '.' + tag : ''}.${judge}.jsonl`); return { run, J: Object.fromEntries(readJsonl(jf).filter((j) => j.ok).map((j) => [j.benchmark_id, j])) }; };
const A = load(opt('a'), opt('a-tag')), B = load(opt('b'), opt('b-tag'));
const pairs = [];
for (const rowA of A.run.rows) {
  const rowB = B.run.rowsById[rowA.benchmark_id]; const jA = A.J[rowA.benchmark_id], jB = B.J[rowA.benchmark_id];
  if (!rowB || !jA || !jB) continue;
  const item = A.run.ds.byId[rowA.benchmark_id]; const itemB = B.run.ds.byId[rowA.benchmark_id] ?? item;
  pairs.push({ item, a: jA.official, b: jB.official, fa: funnel(item, rowA, A.run), fb: funnel(itemB, rowB, B.run), rowB });
}
const f2 = (x) => (x == null ? '–' : (x >= 0 ? '+' : '') + x.toFixed(2));
const line = (label, xs) => {
  if (!xs.length) return;
  const d = xs.map((p) => p.b.overall - p.a.overall); const ci = xs.length >= 5 ? ci95(d) : null;
  console.log(`| ${label} | ${xs.length} | ${mean(xs.map((p) => p.a.overall)).toFixed(2)} | ${mean(xs.map((p) => p.b.overall)).toFixed(2)} | ${f2(mean(d))} | ${ci == null ? '–' : '±' + ci.toFixed(2)} | ${xs.filter((p) => p.a.hard_fail).length} → ${xs.filter((p) => p.b.hard_fail).length} | ${xs.filter((p) => p.fb.evidence_delivered === true).length}/${xs.filter((p) => p.fb.evidence_delivered !== null).length} | ${xs.filter((p) => p.rowB.read_whole).length} |`);
};
console.log(`pairs: ${pairs.length} (judge ${judge}${judge === 'opus' ? ', provisional' : ''})\n`);
console.log('| Slice | n | A mean | B mean | B − A | 95 % | hard fails A → B | delivered in B | read whole in B |\n|---|---:|---:|---:|---:|---:|---|---|---:|');
const req = pairs.filter((p) => p.fa.evidence_required);
line('all pairs', pairs);
line('evidence required', req);
line('P: required, NOT delivered in A', req.filter((p) => p.fa.evidence_delivered === false));
line('control: required, delivered in A and in B', req.filter((p) => p.fa.evidence_delivered === true && p.fb.evidence_delivered === true));
line('required, delivered in A, not in B', req.filter((p) => p.fa.evidence_delivered === true && p.fb.evidence_delivered === false));
line('not evidence-required', pairs.filter((p) => !p.fa.evidence_required));
for (const c of ['grounded_single', 'multi_source', 'conflict_stale', 'followup', 'missing_evidence', 'irrelevant_source']) line(`condition ${c}`, pairs.filter((p) => p.item.condition === c));
for (const m of A.run.ds.modes.map((x) => x.key)) line(`mode ${m}`, pairs.filter((p) => p.item.mode === m));
line('P and read whole in B', req.filter((p) => p.fa.evidence_delivered === false && p.rowB.read_whole));
line('P and retrieved in B', req.filter((p) => p.fa.evidence_delivered === false && !p.rowB.read_whole));
