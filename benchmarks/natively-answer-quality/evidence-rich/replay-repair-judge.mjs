#!/usr/bin/env node
// E10: judge and read the repair replay (replay-repair.mjs). Rule: docs/ITERATIONS-ER.md § E10.
//   prep    writes one derived run per (arm, k, source run): results/rp-e10-<arm>-k<k>--<run>/, whose shown answer is
//           the replayed repair text, and prints the judge commands (only the turns the repair ran on).
//   verdict reads the judgments and applies the four lines of the rule.
// ER_JUDGE=astra (default) | opus. Never pooled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, readJsonl } from './objective.mjs';
import { mean, ci95 } from './judge/score-er.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JUDGE = process.env.ER_JUDGE || 'astra';
const [cmd] = process.argv.slice(2);
const REC = readJsonl(path.join(HERE, 'results', 'replay', 'e10.jsonl'));
const RUNS = [...new Set(REC.map((r) => r.run))];
const ARMS = ['cut', 'whole']; const KS = [...new Set(REC.map((r) => r.k))].sort();
const tag = (arm, k, run) => `rp-e10-${arm}-k${k}--${run}`;
const squash = (t) => String(t ?? '').replace(/\s+/g, '').toLowerCase();

if (cmd === 'prep') {
  for (const run of RUNS) {
    const src = path.join(HERE, 'results', run); const R = loadRun(src);
    for (const arm of ARMS) for (const k of KS) {
      const out = path.join(HERE, 'results', tag(arm, k, run)); fs.mkdirSync(out, { recursive: true });
      for (const f of ['run.json', 'wire.jsonl', 'systems.json', 'ingest.jsonl', 'pi.jsonl']) { const dst = path.join(out, f); if (fs.existsSync(path.join(src, f)) && !fs.existsSync(dst)) fs.symlinkSync(path.join(src, f), dst); }
      const mine = Object.fromEntries(REC.filter((r) => r.run === run && r.arm === arm && r.k === k).map((r) => [r.id, r]));
      const rows = R.rows.filter((row) => mine[row.benchmark_id]).map((row) => ({ ...row, rendered_answer: mine[row.benchmark_id].text || '(no answer)', answer_differs_raw_vs_rendered: true }));
      fs.writeFileSync(path.join(out, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
  }
  const dirs = RUNS.flatMap((run) => ARMS.flatMap((arm) => KS.map((k) => `evidence-rich/results/${tag(arm, k, run)}`)));
  console.log(`AQ_JUDGE=${JUDGE} node evidence-rich/judge/judge-er.mjs --set base --runs ${dirs.join(',')} --concurrency 2`);
} else if (cmd === 'verdict') {
  const J = {}; for (const run of RUNS) for (const arm of ARMS) for (const k of KS) for (const j of readJsonl(path.join(HERE, 'judge', 'out', 'base', `${tag(arm, k, run)}.${JUDGE}.jsonl`))) if (j.ok) J[`${run}|${j.benchmark_id}|${arm}|${k}`] = j.official;
  const ids = [...new Set(REC.map((r) => `${r.run}|${r.id}`))];
  const ds = {}; for (const run of RUNS) ds[run] = loadRun(path.join(HERE, 'results', run));
  const per = { cut: { score: [], hard: 0, facts: 0, first: [], inDeadline: 0, n: 0 }, whole: { score: [], hard: 0, facts: 0, first: [], inDeadline: 0, n: 0 } };
  const diffs = []; let missing = 0;
  for (const key of ids) {
    const [run, id] = key.split('|');
    const item = ds[run].ds.byId[id]; const needles = (item?.oracle?.required_facts ?? []).flatMap((f) => f.doc_needles ?? f.answer_needles ?? []).filter((x) => String(x).length >= 4);
    const both = ARMS.map((arm) => KS.map((k) => J[`${key}|${arm}|${k}`]));
    if (both.flat().some((o) => !o)) { missing++; continue; }
    const m = {};
    for (const arm of ARMS) {
      const recs = KS.map((k) => REC.find((r) => r.run === run && r.id === id && r.arm === arm && r.k === k));
      const os = KS.map((k) => J[`${key}|${arm}|${k}`]);
      m[arm] = mean(os.map((o) => o.overall)); per[arm].score.push(m[arm]);
      per[arm].hard += os.filter((o) => o.hard_fail).length / KS.length;
      per[arm].facts += recs.reduce((n, r) => n + needles.filter((x) => squash(r.text).includes(squash(x))).length, 0);
      for (const r of recs) { per[arm].n++; if (r.ms_first !== null) per[arm].first.push(r.ms_first); if (r.stop !== 'deadline' && !String(r.stop).startsWith('error')) per[arm].inDeadline++; }
    }
    diffs.push(m.whole - m.cut);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  console.log(`judge ${JUDGE}; turns ${diffs.length}${missing ? ` (left out, not judged yet: ${missing})` : ''}; k ${KS.length}`);
  for (const arm of ARMS) console.log(`  ${arm.padEnd(5)} mean ${mean(per[arm].score).toFixed(3)}  hard fails ${per[arm].hard.toFixed(1)}  needed-fact strings ${per[arm].facts}  first useful median ${med(per[arm].first)} ms  inside 7 s ${(100 * per[arm].inDeadline / per[arm].n).toFixed(1)} %`);
  const d = mean(diffs);
  const lines = [
    ['1 needed facts whole ≥ cut', per.whole.facts >= per.cut.facts, `${per.whole.facts} vs ${per.cut.facts}`],
    ['2 judge whole − cut ≥ −0.05', d >= -0.05, `${d >= 0 ? '+' : ''}${d.toFixed(3)} ±${ci95(diffs).toFixed(3)}`],
    ['3 hard fails whole ≤ cut + 1', per.whole.hard <= per.cut.hard + 1, `${per.whole.hard.toFixed(1)} vs ${per.cut.hard.toFixed(1)}`],
    ['4 first useful median ≤ cut + 600 ms, inside 7 s ≥ cut − 2 pp', med(per.whole.first) <= med(per.cut.first) + 600 && (100 * per.whole.inDeadline / per.whole.n) >= (100 * per.cut.inDeadline / per.cut.n) - 2, `${med(per.whole.first)} vs ${med(per.cut.first)} ms`],
  ];
  for (const [name, ok, detail] of lines) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  console.log(`VERDICT: ${lines.every((l) => l[1]) ? 'KEEP' : 'REVERT'}`);
} else { console.error('prep | verdict'); process.exit(2); }
