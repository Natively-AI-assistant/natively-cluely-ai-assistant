#!/usr/bin/env node
// Aggregates for a paired comparison planned by plan-pair.mjs: the rows where two replay arms differ, both sides
// judged by exact gpt-6-astra. Prints counts and means only (no ids, questions, answers or explanations), so it is
// safe on the blind holdout.
//   node evidence-rich/report/pair-aggregate.mjs --plan evidence-rich/results/replay/<plan>.json[,<plan2>.json] [--out <file.json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, readJsonl } from '../objective.mjs';
const ER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
// --plan a.json,b.json pools the pairs of several plans (two repetitions of the same arms); each pair keeps its own arms.
const plans = String(opt('plan')).split(',').map((f) => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')));
const plan = { arms: plans.map((q) => q.arms.join(' → ')), pairs: plans.flatMap((q) => q.pairs.map((x) => ({ ...x, arms: q.arms }))) };
const cache = {}; const judged = (file) => (cache[file] ??= new Map(readJsonl(path.join(ER, 'judge', 'out', 'base', `${file}.astra.jsonl`)).filter((j) => j.ok).map((j) => [j.benchmark_id, j])));
const exact = (j) => j.judge_model === 'gpt-6-astra' && j.judge_status === 'canonical' && (j.calls ?? []).every((c) => !c.model_mismatch && c.returned_model === 'gpt-6-astra');
const get = (p, src, armName) => judged(src === 'new' ? `rp-${armName}--${p.run}` : src === 'draft' ? `${p.run}.draft` : p.run).get(p.id);
const items = {}; for (const run of [...new Set(plan.pairs.map((p) => p.run))]) { const r = loadRun(path.join(ER, 'results', run)); items[run] = r.ds.byId; }
const rows = plan.pairs.map((p) => ({ p, a: get(p, p.sa, p.arms[0]), b: get(p, p.sb, p.arms[1]) }));
const ok = rows.filter((r) => r.a && r.b);
const flags = (j) => j.official.flags ?? j.judgment.hard_flags ?? [];
const conflictFlag = (j) => flags(j).some((f) => f === 'source_conflict_ignored' || f === 'stale_source_preferred');
const invention = (j) => flags(j).some((f) => /^(unsupported_|fabricated_)/.test(f));
const mean = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
const side = (k) => ({ mean: mean(ok.map((r) => r[k].official.overall)), hard_fails: ok.filter((r) => r[k].official.hard_fail).length, conflict_flag_rows: ok.filter((r) => conflictFlag(r[k])).length, invention_rows: ok.filter((r) => invention(r[k])).length });
const d = ok.map((r) => r.b.official.overall - r.a.official.overall);
const unresolved = plan.pairs.filter((p) => (items[p.run][p.id]?.oracle?.known_conflicts ?? []).some((c) => c.resolution === 'unresolved')).length;
const half = d.length > 1 ? 1.96 * Math.sqrt(d.reduce((t, x) => t + (x - mean(d)) ** 2, 0) / (d.length - 1)) / Math.sqrt(d.length) : null;
const out = { at: new Date().toISOString(), arms: plan.arms, judge: 'gpt-6-astra', rows_that_differ: plan.pairs.length, both_judged: ok.length, missing: rows.length - ok.length, model_unverified: ok.filter((r) => !exact(r.a) || !exact(r.b)).length,
  control: side('a'), candidate: side('b'), mean_change: ok.length ? mean(d) : null, mean_change_ci95_half_width: half, rows_up_by_1: d.filter((x) => x >= 1).length, rows_down_by_half: d.filter((x) => x <= -0.5).length, rows_with_an_unresolved_oracle_conflict: unresolved };
if (opt('out')) fs.writeFileSync(path.resolve(opt('out')), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
