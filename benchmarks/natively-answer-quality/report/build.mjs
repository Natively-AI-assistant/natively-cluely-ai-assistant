#!/usr/bin/env node
// Builds report/data.json from judged runs + run rows: scorecards, trajectories, grounding reliability,
// latency and length distributions, worst answers. Pure aggregation; nothing is re-judged.
//   node report/build.mjs --pairs final:j-final-base:j-final-fix,holdout:j-holdout-base:j-holdout-fix --dev j-dev-base,j-dev-it1,...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJudged, officialOverall, SEVERE_FLAGS } from '../judge/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];

const pct = (v, p) => { const a = v.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r); return a[lo] + (a[hi] - a[lo]) * (r - lo); };
const mean = (v) => { const a = v.filter(x => x != null && Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
const rowsCache = {};
const runRows = (runId) => (rowsCache[runId] ??= Object.fromEntries(fs.readFileSync(path.join(ROOT, 'results', runId, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.benchmark_id, r])));

function judgedSet(name) {
  const js = loadJudged([name]);
  for (const r of js) { r.row = runRows(r.run_id)[r.benchmark_id]; r.mode = r.row?.mode; Object.assign(r, officialOverall(r.judge, r.mode)); r.flags = r.judge.hard_flags ?? []; }
  return js;
}
function modeStats(rs) {
  const ov = rs.map(r => r.overall);
  const dim = (k) => mean(rs.map(r => Number(r.judge.scores?.[k] ?? 0)));
  const fc = {}; for (const r of rs) for (const f of r.flags) fc[f] = (fc[f] ?? 0) + 1;
  return {
    n: rs.length, mean: mean(ov), median: pct(ov, 50), p10: pct(ov, 10),
    hard_fail_n: rs.filter(r => r.flags.some(f => SEVERE_FLAGS.includes(f))).length,
    hard_fail_pct: rs.length ? rs.filter(r => r.flags.some(f => SEVERE_FLAGS.includes(f))).length / rs.length * 100 : null,
    grounding: dim('grounding'), role: dim('role_fidelity'), correctness: dim('correctness'), usefulness: dim('direct_usefulness'), concision: dim('concision'),
    flags: fc,
  };
}
function byMode(js) { const o = {}; for (const m of [...MODES, 'ALL']) { const rs = js.filter(r => m === 'ALL' || r.mode === m); if (rs.length) o[m] = modeStats(rs); } return o; }

function objective(runId) {
  const rows = Object.values(runRows(runId));
  const out = {};
  for (const m of [...MODES, 'ALL']) {
    const rs = rows.filter(r => m === 'ALL' || r.mode === m);
    if (!rs.length) continue;
    const need = rs.filter(r => (r.needles ?? []).length);
    const refNeed = need.filter(r => r.reference_attached);
    const piNeed = need.filter(r => r.pi_ref && r.pi_eligible);
    const allIn = (r) => r.needles_in_prompt.every(Boolean);
    const anyAns = (r) => r.needles_in_answer.some(Boolean);
    const piRows = rs.filter(r => r.pi_ref);
    out[m] = {
      rows: rs.length,
      ttft: { mean: mean(rs.map(r => r.ttft_ms)), p50: pct(rs.map(r => r.ttft_ms), 50), p90: pct(rs.map(r => r.ttft_ms), 90), p95: pct(rs.map(r => r.ttft_ms), 95), p99: pct(rs.map(r => r.ttft_ms), 99) },
      total: { mean: mean(rs.map(r => r.total_latency_ms)), p50: pct(rs.map(r => r.total_latency_ms), 50), p90: pct(rs.map(r => r.total_latency_ms), 90), p95: pct(rs.map(r => r.total_latency_ms), 95), p99: pct(rs.map(r => r.total_latency_ms), 99) },
      words: { p10: pct(rs.map(r => r.word_count_excl_gist), 10), p50: pct(rs.map(r => r.word_count_excl_gist), 50), p90: pct(rs.map(r => r.word_count_excl_gist), 90), mean: mean(rs.map(r => r.word_count_excl_gist)) },
      speech_s_p50: pct(rs.map(r => r.estimated_speech_seconds_excl_gist), 50),
      over_30s_pct: rs.filter(r => r.estimated_speech_seconds_excl_gist > 30).length / rs.length * 100,
      headings_pct: rs.filter(r => r.has_headings).length / rs.length * 100,
      code_block_pct: rs.filter(r => r.has_code_block).length / rs.length * 100,
      raw_vs_rendered_diff_pct: rs.filter(r => r.answer_differs_raw_vs_rendered).length / rs.length * 100,
      second_pass_pct: rs.filter(r => (r.second_pass_requests ?? 0) > 0).length / rs.length * 100,
      errors: rs.filter(r => !r.success).length,
      needle_rows: need.length,
      needles_in_prompt_pct: need.length ? need.filter(allIn).length / need.length * 100 : null,
      needles_used_in_answer_pct: need.length ? need.filter(anyAns).length / need.length * 100 : null,
      ref_needle_rows: refNeed.length,
      ref_needles_in_prompt_pct: refNeed.length ? refNeed.filter(allIn).length / refNeed.length * 100 : null,
      ref_attached_rows: rs.filter(r => r.reference_attached).length,
      ref_evidence_in_prompt_pct: rs.filter(r => r.reference_attached).length ? rs.filter(r => r.reference_attached && r.reference_evidence_in_prompt).length / rs.filter(r => r.reference_attached).length * 100 : null,
      pi_rows: piRows.length,
      pi_eligible_rows: piRows.filter(r => r.pi_eligible).length,
      pi_evidence_in_prompt_pct: piRows.filter(r => r.pi_eligible).length ? piRows.filter(r => r.pi_eligible && r.profile_evidence_in_prompt).length / piRows.filter(r => r.pi_eligible).length * 100 : null,
      pi_needle_rows: piNeed.length,
      pi_needles_in_prompt_pct: piNeed.length ? piNeed.filter(allIn).length / piNeed.length * 100 : null,
      pi_leak_rows: rs.filter(r => r.pi_leak).length,
    };
  }
  return out;
}

const data = { generated_at: new Date().toISOString(), pairs: {}, dev: [], objective: {}, worst: {} };
for (const spec of String(opt('pairs', '')).split(',').filter(Boolean)) {
  const [label, base, fix] = spec.split(':');
  const jb = judgedSet(base), jf = judgedSet(fix);
  data.pairs[label] = { base: { set: base, run: jb[0]?.run_id, modes: byMode(jb) }, fix: { set: fix, run: jf[0]?.run_id, modes: byMode(jf) } };
  data.objective[jb[0]?.run_id] = objective(jb[0]?.run_id);
  data.objective[jf[0]?.run_id] = objective(jf[0]?.run_id);
  data.worst[label] = jf.sort((a, b) => a.overall - b.overall).slice(0, 12).map(r => ({
    id: r.benchmark_id, mode: r.mode, overall: +r.overall.toFixed(2), flags: r.flags, question: r.row?.question,
    answer: String(r.row?.rendered_answer ?? r.row?.raw_answer ?? '').replace(/\[\[GIST\]\][\s\S]*$/, '').trim(),
    problem: r.judge.specific_problem ?? r.judge.one_sentence_reason, improvement: r.judge.minimal_improvement,
  }));
}
for (const name of String(opt('dev', '')).split(',').filter(Boolean)) {
  const js = judgedSet(name);
  data.dev.push({ set: name, run: js[0]?.run_id, modes: byMode(js) });
  data.objective[js[0]?.run_id] ??= objective(js[0]?.run_id);
}
fs.writeFileSync(path.join(HERE, 'data.json'), JSON.stringify(data, null, 1));
const f = (x) => (x == null ? '-' : x.toFixed(2));
for (const [label, p] of Object.entries(data.pairs)) {
  console.log(`\n## ${label}: ${p.base.run} -> ${p.fix.run}`);
  console.log('| mode | base | fix | Δ | hard base | hard fix |');
  for (const m of [...MODES, 'ALL']) { const b = p.base.modes[m], x = p.fix.modes[m]; if (!b || !x) continue; console.log(`| ${m} | ${f(b.mean)} | ${f(x.mean)} | ${f(x.mean - b.mean)} | ${b.hard_fail_n}/${b.n} | ${x.hard_fail_n}/${x.n} |`); }
}
console.log('\nwrote report/data.json');
