#!/usr/bin/env node
// Judging and reading the arms of replay-claim-pass.mjs.
//
//   prep   --arm <name> --runs evidence-rich/results/er-dev-e1,…      (k 0 of the arm)
//          writes one derived run per source run, results/rp-<arm>--<run>/, whose shown answer is the arm's text for
//          the rows whose text is NEW (not the draft, not the text the app showed), and prints the judge command.
//   effect --a <arm> --b <arm> --runs …  [--blind]
//          the effect of the pass per arm (shown − draft; a row the pass did not change counts 0) and b − a, paired.
//
// A text equal to the draft reuses the draft's judgment; a text equal to what the app showed reuses that judgment;
// only new texts are judged. ER_JUDGE=opus (default, provisional) or astra; never pooled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, funnel, readJsonl, answerOf, splitGist } from './objective.mjs';
import { mean, ci95 } from './judge/score-er.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JUDGE = process.env.ER_JUDGE || 'opus';
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const runs = String(opt('runs')).split(',').map((r) => path.resolve(HERE, '..', r));
const body = (t) => splitGist(t).body.replace(/\s+/g, ' ').trim();
// --k N reads repetition N of an arm (default 0). An arm name may also carry it: "e9-ctl@1".
const splitK = (name) => { const m = String(name).match(/^(.*)@(\d+)$/); return m ? { base: m[1], k: Number(m[2]) } : { base: String(name), k: Number(opt('k', 0)) }; };
const tagOf = (name) => { const { base, k } = splitK(name); return k ? `${base}-k${k}` : base; };
const arm = (name) => { const { base, k } = splitK(name); const m = {}; for (const r of readJsonl(path.join(HERE, 'results', 'replay', `${base}.jsonl`))) if (r.k === k) m[`${r.run}|${r.id}`] = r; return m; };
const judged = (runName, draft = false) => Object.fromEntries(readJsonl(path.join(HERE, 'judge', 'out', 'base', `${runName}${draft ? '.draft' : ''}.${JUDGE}.jsonl`)).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));

/** Where a replayed text's judgment comes from: 'draft', 'app' (the text the app showed), or 'new'. */
function source(row, rec) {
  if (!rec || !rec.changed || body(rec.text) === body(row.raw_answer)) return 'draft';
  if (row.answer_differs_raw_vs_rendered && body(rec.text) === body(answerOf(row))) return 'app';
  return 'new';
}

if (cmd === 'prep') {
  const name = opt('arm'); const A = arm(name);
  for (const dir of runs) {
    const run = loadRun(dir); const runName = path.basename(dir); const out = path.join(HERE, 'results', `rp-${tagOf(name)}--${runName}`);
    fs.mkdirSync(out, { recursive: true });
    for (const f of ['run.json', 'wire.jsonl', 'systems.json', 'ingest.jsonl', 'pi.jsonl']) { const dst = path.join(out, f); if (fs.existsSync(path.join(dir, f)) && !fs.existsSync(dst)) fs.symlinkSync(path.join(dir, f), dst); }
    const ids = []; const lines = [];
    for (const row of run.rows) { const rec = A[`${runName}|${row.benchmark_id}`]; if (source(row, rec) === 'new') { ids.push(row.benchmark_id); lines.push(JSON.stringify({ ...row, rendered_answer: rec.text, answer_differs_raw_vs_rendered: true })); } else lines.push(JSON.stringify(row)); }
    fs.writeFileSync(path.join(out, 'rows.jsonl'), lines.join('\n') + '\n');
    const counts = { draft: 0, app: 0, new: 0 }; for (const row of run.rows) counts[source(row, A[`${runName}|${row.benchmark_id}`])]++;
    console.log(`${tagOf(name)} / ${runName}: ${JSON.stringify(counts)}`);
    if (ids.length) console.log(`AQ_JUDGE=${JUDGE} node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/rp-${tagOf(name)}--${runName} --ids ${ids.join(',')} --concurrency 4${opt('blind') ? ' --blind' : ''}`);
  }
} else if (cmd === 'effect') {
  const names = [opt('a'), opt('b')]; const arms = names.map(arm); const R = [];
  for (const dir of runs) {
    const run = loadRun(dir); const runName = path.basename(dir); const S = judged(runName), D = judged(runName, true);
    const N = names.map((n) => judged(`rp-${tagOf(n)}--${runName}`));
    for (const row of run.rows) {
      const s = S[row.benchmark_id]; if (!s) continue; const item = run.ds.byId[row.benchmark_id];
      const draft = (row.answer_differs_raw_vs_rendered ? D[row.benchmark_id] : s)?.official; if (!draft) continue;
      const v = arms.map((A, i) => { const rec = A[`${runName}|${row.benchmark_id}`]; const src = source(row, rec); return { rec, src, o: src === 'draft' ? draft : src === 'app' ? s.official : N[i][row.benchmark_id]?.official ?? null }; });
      if (v.some((x) => !x.o)) { R.missing = (R.missing ?? 0) + 1; continue; }
      R.push({ item, row, draft, v, fn: funnel(item, row, run) });
    }
  }
  const f2 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
  console.log(`rows ${R.length}${R.missing ? ` (left out, a new text not judged yet: ${R.missing})` : ''}; judge ${JUDGE}`);
  names.forEach((n, i) => { const eff = R.map((r) => r.v[i].o.overall - r.draft.overall); const withPass = R.filter((r) => r.v[i].rec); const outcome = {}; for (const r of withPass) { const k = String(r.v[i].rec.outcome).replace(/:.*/, ''); outcome[k] = (outcome[k] ?? 0) + 1; }
    const fin = withPass.filter((r) => !/deadline|error|abort|timeout|stall/.test(r.v[i].rec.outcome)).length; const ms = withPass.map((r) => r.v[i].rec.ms).sort((a, b) => a - b);
    console.log(`arm ${n}: mean ${mean(R.map((r) => r.v[i].o.overall)).toFixed(2)}; effect of the pass ${f2(mean(eff))} ±${ci95(eff).toFixed(2)}; hard fails ${R.filter((r) => r.v[i].o.hard_fail).length} (drafts ${R.filter((r) => r.draft.hard_fail).length}); critical ${R.filter((r) => r.v[i].o.critical).length}; passes ${withPass.length}, changed ${withPass.filter((r) => r.v[i].rec.changed).length}, finished in budget ${fin} (${(100 * fin / withPass.length).toFixed(1)} %), ms p50 ${ms[Math.floor(ms.length / 2)]} p90 ${ms[Math.floor(ms.length * 0.9)]}`);
    if (!opt('blind')) console.log(`   outcomes ${JSON.stringify(outcome)}`); });
  const line = (l, xs) => { if (!xs.length) return; const d = xs.map((r) => r.v[1].o.overall - r.v[0].o.overall); console.log(`  ${l.padEnd(56)} n ${String(xs.length).padStart(3)}  ${names[1]} − ${names[0]}: ${f2(mean(d))}${xs.length >= 5 ? ' ±' + ci95(d).toFixed(2) : ''}  hard fails ${xs.filter((r) => r.v[0].o.hard_fail).length} → ${xs.filter((r) => r.v[1].o.hard_fail).length}`); };
  line('all rows', R); line('rows where the two arms show different text', R.filter((r) => body(r.v[0].rec?.text ?? r.row.raw_answer) !== body(r.v[1].rec?.text ?? r.row.raw_answer)));
  line('evidence required and in the prompt', R.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered === true)); line('evidence required, not in the prompt', R.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered === false));
  line('need no document (missing + irrelevant)', R.filter((r) => ['missing_evidence', 'irrelevant_source'].includes(r.item.condition))); line('conflict / stale', R.filter((r) => r.item.condition === 'conflict_stale'));
  const res = (r) => (r.item.oracle.known_conflicts ?? []).map((c) => c.resolution);
  line("oracle: an UNRESOLVED conflict (must be surfaced)", R.filter((r) => res(r).includes('unresolved')));
  line('oracle: conflict resolved (current / final / authoritative wins)', R.filter((r) => res(r).length && !res(r).includes('unresolved')));
  line('heard', R.filter((r) => r.row.surface !== 'typed')); line('typed', R.filter((r) => r.row.surface === 'typed'));
  if (!opt('blind')) for (const m of [...new Set(R.map((r) => r.item.mode))]) line(`mode ${m}`, R.filter((r) => r.item.mode === m));
} else { console.error('prep | effect'); process.exit(2); }
