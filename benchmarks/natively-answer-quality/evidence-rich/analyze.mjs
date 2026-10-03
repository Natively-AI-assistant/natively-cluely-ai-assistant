#!/usr/bin/env node
// evidence-rich-v1 analysis: the evidence pipeline funnel (judge-free) and, when judgments exist, quality by mode
// and by evidence condition.
//
//   node evidence-rich/analyze.mjs --runs evidence-rich/results/<run>[,<run2>] [--set <judge set>] [--judge opus|astra]
//        [--json out.json] [--worst 20] [--blind]
//
// Several runs are pooled (dev + supplementary sets of the SAME build). Judgments of two judges are never pooled:
// --judge picks one series. --blind prints aggregates only (holdout): no ids, no questions, no answers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, funnel, objective, readJsonl, answerOf, PI_MODES } from './objective.mjs';
import { mean, pct, ci95, CAP_FLAGS, CRITICAL_FLAGS } from './judge/score-er.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const runs = String(opt('runs', '')).split(',').filter(Boolean).map((r) => path.resolve(HERE, '..', r));
const set = opt('set'); const judge = opt('judge', 'opus'); const blind = !!opt('blind'); const worstN = Number(opt('worst', 20));
const MODE_ORDER = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];
const f1 = (x) => (x == null ? '–' : x.toFixed(1)); const f2 = (x) => (x == null ? '–' : x.toFixed(2));
const pc = (n, d) => (d ? `${(100 * n / d).toFixed(1)} % (${n}/${d})` : '– (0)');
const APP_FALLBACK_RE = /didn.t come through from the AI provider|couldn.t generate an answer just now|No answer came back this time|did not produce an answer in time/i;

// ---- collect ----
const recs = [];
const headers = [];
for (const dir of runs) {
  const run = loadRun(dir);
  headers.push(run.header);
  const jf = set ? path.join(process.env.ER_BENCH_DIR ? path.resolve(process.env.ER_BENCH_DIR) : HERE, 'judge', 'out', set, `${path.basename(dir)}.${judge}.jsonl`) : null;
  const judged = jf ? Object.fromEntries(readJsonl(jf).filter((j) => j.ok).map((j) => [j.benchmark_id, j])) : {};
  for (const row of run.rows) {
    const item = run.ds.byId[row.benchmark_id];
    if (!item) continue;
    const unverified = row.error_type === 'environment_state_unverified';
    const fn = unverified ? null : funnel(item, row, run);
    const obj = unverified || row.success === false ? null : objective(item, row);
    recs.push({ row, item, fn, obj, j: judged[row.benchmark_id] ?? null, partition: run.header.partition, unverified, provider_failure: !unverified && (row.success === false || APP_FALLBACK_RE.test(answerOf(row))) });
  }
}
const asked = recs.filter((r) => !r.unverified);
const answered = asked.filter((r) => !r.provider_failure);
const out = { runs: headers.map((h) => ({ run_id: h.run_id, partition: h.partition, git_commit: h.git_commit, dataset_sha256: h.dataset_sha256, manifest_sha256: h.manifest_sha256, generator: h.generator, local_models: h.local_models, started_at: h.started_at, finished_at: h.finished_at })), judge: set ? { set, judge } : null };

// ---- 1. rows ----
out.rows = { total: recs.length, environment_state_unverified: recs.length - asked.length, provider_failure_or_timeout: asked.length - answered.length, answered: answered.length };
console.log(`# rows\n${recs.length} rows: ${answered.length} answered, ${asked.length - answered.length} provider failure/timeout, ${recs.length - asked.length} not asked (state unverified)`);
const gens = {};
for (const r of answered) { const k = `${r.row.generator_provider}/${r.row.generator_model}`; gens[k] = (gens[k] ?? 0) + 1; }
out.generator_routes = gens;
console.log(`generator routes: ${Object.entries(gens).map(([k, n]) => `${k} ${n}`).join(', ')}`);

// ---- 2. reference pipeline, per mode ----
const stage = (xs, f) => { const a = xs.map(f).filter((v) => v !== null && v !== undefined); return { n: a.filter(Boolean).length, d: a.length }; };
function refFunnel(xs) {
  const need = xs.filter((r) => r.fn.file_uploaded !== null); // cases whose answer rests on at least one reference file
  return {
    cases: need.length,
    uploaded: stage(need, (r) => r.fn.file_uploaded), parsed: stage(need, (r) => r.fn.file_parse_success), fact_survived_parse: stage(need, (r) => r.fn.fact_survived_parse),
    indexed: stage(need, (r) => r.fn.file_indexed), retrieval_attempted: stage(need, (r) => r.fn.read_whole ? true : r.fn.retrieval_attempted),
    correct_source_in_prompt: stage(need, (r) => r.fn.correct_source_retrieved), any_correct_source_in_prompt: stage(need, (r) => r.fn.any_correct_source_retrieved),
    fact_in_prompt: stage(need, (r) => r.fn.doc_fact_reached_prompt), wrong_source_only: stage(need, (r) => r.fn.wrong_source_retrieved),
    read_whole: stage(need, (r) => !!r.fn.read_whole),
    answer_has_required_string: stage(need.filter((r) => r.obj?.required_strings.total), (r) => r.obj.required_strings.found === r.obj.required_strings.total),
  };
}
console.log('\n# reference pipeline (cases whose answer rests on a reference file)');
console.log('| mode | cases | uploaded | parsed | fact survived parse | indexed | right file in prompt | fact in prompt | wrong file only | read whole |');
console.log('|---|---:|---|---|---|---|---|---|---|---|');
out.reference_pipeline = {};
for (const m of [...MODE_ORDER, 'ALL']) {
  const xs = answered.filter((r) => m === 'ALL' || r.item.mode === m);
  const f = refFunnel(xs); out.reference_pipeline[m] = f;
  if (!f.cases) continue;
  const s = (k) => pc(f[k].n, f[k].d);
  console.log(`| ${m} | ${f.cases} | ${s('uploaded')} | ${s('parsed')} | ${s('fact_survived_parse')} | ${s('indexed')} | ${s('correct_source_in_prompt')} | ${s('fact_in_prompt')} | ${s('wrong_source_only')} | ${s('read_whole')} |`);
}
// stale / conflict handling in the prompt
const staleCases = answered.filter((r) => r.fn.stale_source_retrieved !== null && r.item.condition === 'conflict_stale');
out.stale = { conflict_cases: staleCases.length, stale_file_in_prompt: staleCases.filter((r) => r.fn.stale_source_retrieved).length, stale_value_in_prompt: staleCases.filter((r) => r.fn.stale_value_in_prompt).length, current_fact_in_prompt: staleCases.filter((r) => r.fn.doc_fact_reached_prompt).length };
console.log(`\nconflict cases ${out.stale.conflict_cases}: outdated/draft file in prompt ${out.stale.stale_file_in_prompt}, outdated value in prompt ${out.stale.stale_value_in_prompt}, current fact in prompt ${out.stale.current_fact_in_prompt}`);

// ---- 3. profile intelligence pipeline ----
const piCases = answered.filter((r) => r.fn.correct_profile_reached_prompt !== null);
out.pi_pipeline = {
  cases: piCases.length, profile_loaded: stage(piCases, (r) => r.fn.profile_loaded), resume_parsed: stage(piCases.filter((r) => /A$|B$|RESUME/.test(r.row.pi_state)), (r) => r.fn.resume_parsed),
  jd_parsed: stage(piCases.filter((r) => /A$|B$|JD/.test(r.row.pi_state)), (r) => r.fn.jd_parsed), pi_retrieval_attempted: stage(piCases, (r) => r.fn.pi_retrieval_attempted),
  correct_profile_in_prompt: stage(piCases, (r) => r.fn.correct_profile_reached_prompt), pi_fact_in_prompt: stage(piCases, (r) => r.fn.pi_fact_reached_prompt),
  extraction_modes: answered.filter((r) => r.row.pi_state !== 'none').reduce((a, r) => { a[r.row.pi_extraction_mode ?? 'unknown'] = (a[r.row.pi_extraction_mode ?? 'unknown'] ?? 0) + 1; return a; }, {}),
};
const P = out.pi_pipeline;
console.log(`\n# profile pipeline (cases whose answer rests on résumé / JD): ${P.cases}`);
console.log(`profile loaded ${pc(P.profile_loaded.n, P.profile_loaded.d)} · résumé parsed ${pc(P.resume_parsed.n, P.resume_parsed.d)} · JD parsed ${pc(P.jd_parsed.n, P.jd_parsed.d)} · PI sources offered ${pc(P.pi_retrieval_attempted.n, P.pi_retrieval_attempted.d)} · right profile evidence in prompt ${pc(P.correct_profile_in_prompt.n, P.correct_profile_in_prompt.d)} · PI fact in prompt ${pc(P.pi_fact_in_prompt.n, P.pi_fact_in_prompt.d)}`);
console.log(`résumé extraction mode on PI rows: ${JSON.stringify(P.extraction_modes)}`);

// ---- 4. isolation (objective, every answered row) ----
const iso = {
  rows: answered.length,
  cross_mode_file_in_prompt: answered.filter((r) => r.fn.cross_mode_source_in_prompt.length).length,
  unknown_file_in_prompt: answered.filter((r) => r.fn.unknown_source_in_prompt.length).length,
  reference_evidence_with_no_file_loaded: answered.filter((r) => r.fn.reference_evidence_without_files).length,
  pi_loaded_rows_in_non_pi_modes: answered.filter((r) => !PI_MODES.has(r.item.mode) && r.fn.pi_loaded).length,
  pi_evidence_in_non_pi_mode_prompt: answered.filter((r) => r.fn.pi_in_forbidden_mode_prompt).length,
  pi_rows: answered.filter((r) => PI_MODES.has(r.item.mode) && r.fn.pi_loaded).length,
  other_profile_in_prompt: answered.filter((r) => r.fn.wrong_profile_reached_prompt).length,
  other_profile_in_answer: answered.filter((r) => (r.obj?.flags ?? []).includes('wrong_profile_used')).length,
  other_profile_in_answer_with_prompt_leak: answered.filter((r) => (r.obj?.flags ?? []).includes('wrong_profile_used') && r.fn.wrong_profile_reached_prompt).length,
  pi_string_in_answer_non_pi_mode: answered.filter((r) => (r.obj?.flags ?? []).includes('pi_leak')).length,
  other_mode_string_in_answer: answered.filter((r) => (r.obj?.flags ?? []).includes('cross_mode_reference_leak')).length,
  residue_after_profile_overwrite: answered.filter((r) => (r.row.pi_other_profile_residue ?? []).length).length,
};
out.isolation = iso;
console.log(`\n# isolation (code checks on ${iso.rows} answered rows)`);
console.log(`another mode's file in the prompt: ${iso.cross_mode_file_in_prompt} · unknown file in the prompt: ${iso.unknown_file_in_prompt} · reference evidence with no file loaded: ${iso.reference_evidence_with_no_file_loaded}`);
console.log(`PI loaded while in a non-PI mode: ${iso.pi_loaded_rows_in_non_pi_modes} rows, PI evidence in their prompt: ${iso.pi_evidence_in_non_pi_mode_prompt}, PI string in their answer: ${iso.pi_string_in_answer_non_pi_mode}`);
console.log(`PI rows ${iso.pi_rows}: other profile's strings in the prompt ${iso.other_profile_in_prompt}, in the answer ${iso.other_profile_in_answer} (of which with that text in the prompt: ${iso.other_profile_in_answer_with_prompt_leak}); rows run after a profile overwrite that left residue in the stored profile: ${iso.residue_after_profile_overwrite}`);
console.log(`another mode's fixed string in the answer (isolation items): ${iso.other_mode_string_in_answer}`);

// ---- 5. latency and stalls ----
const q = (xs, f) => { const v = xs.map(f).filter((x) => typeof x === 'number'); return { n: v.length, p50: pct(v, 50), p90: pct(v, 90), p99: pct(v, 99) }; };
const lat = {
  ttft_ms: q(answered, (r) => r.row.ttft_ms), request_dispatch_ms: q(answered, (r) => r.row.request_dispatch_ms), total_ms: q(answered, (r) => r.row.total_latency_ms),
  settle_after_last_token_ms: q(answered.filter((r) => r.row.surface === 'hotkey'), (r) => (r.row.total_latency_ms != null && r.row.last_token_ms != null ? r.row.total_latency_ms - r.row.last_token_ms : null)),
  retrieval_ms: q(answered, (r) => r.fn.retrieval_ms), orchestrate_ms: q(answered, (r) => r.fn.orchestrate_ms),
  ttft_hotkey: q(answered.filter((r) => r.row.surface === 'hotkey'), (r) => r.row.ttft_ms), ttft_typed: q(answered.filter((r) => r.row.surface === 'typed'), (r) => r.row.ttft_ms),
  ttft_pi_rows: q(answered.filter((r) => r.fn.pi_evidence_in_prompt), (r) => r.row.ttft_ms), dispatch_pi_rows: q(answered.filter((r) => r.fn.pi_evidence_in_prompt), (r) => r.row.request_dispatch_ms),
  rows_with_second_pass: answered.filter((r) => (r.row.second_pass_requests ?? 0) > 0).length, shown_text_replaced: answered.filter((r) => r.row.answer_differs_raw_vs_rendered).length,
  first_token_over_3s: asked.filter((r) => (r.row.ttft_ms ?? 0) > 3000).length, over_5s: asked.filter((r) => (r.row.ttft_ms ?? 0) > 5000).length, over_10s: asked.filter((r) => (r.row.ttft_ms ?? 0) > 10000).length,
  timeouts: asked.filter((r) => r.row.timeout).length, provider_failure_lines: asked.filter((r) => r.provider_failure && !r.row.timeout).length,
};
out.latency = lat;
const L = (k) => `${Math.round(lat[k].p50 ?? 0)} / ${Math.round(lat[k].p90 ?? 0)} ms`;
console.log(`\n# latency (median / p90)\nfirst word ${L('ttft_ms')} (heard ${L('ttft_hotkey')}, typed ${L('ttft_typed')}, rows with PI evidence ${L('ttft_pi_rows')}) · request sent ${L('request_dispatch_ms')} · retrieval ${L('retrieval_ms')} · orchestration ${L('orchestrate_ms')} · settled answer ${L('total_ms')} · settle after last token (heard) ${L('settle_after_last_token_ms')}`);
console.log(`second request on ${lat.rows_with_second_pass} rows; shown text replaced on ${lat.shown_text_replaced}; first word >3 s: ${lat.first_token_over_3s}, >5 s: ${lat.over_5s}, >10 s: ${lat.over_10s}; timeouts ${lat.timeouts}; provider-failure lines ${lat.provider_failure_lines}`);

// ---- 6. objective checks ----
const objFail = answered.filter((r) => r.obj?.verdict === 'fail');
out.objective = { applicable: answered.filter((r) => r.obj && r.obj.verdict !== 'n/a').length, fail: objFail.length, by_flag: objFail.flatMap((r) => r.obj.flags).reduce((a, f) => { a[f] = (a[f] ?? 0) + 1; return a; }, {}) };
console.log(`\n# objective checks\n${out.objective.applicable} rows with a deterministic check, ${out.objective.fail} proven wrong ${JSON.stringify(out.objective.by_flag)}`);

// ---- 7. judged quality ----
const judgedRecs = answered.filter((r) => r.j);
if (set) {
  const sc = (xs) => xs.map((r) => r.j.official.overall);
  const line = (label, xs) => {
    const v = sc(xs); if (!v.length) return null;
    const hf = xs.filter((r) => r.j.official.hard_fail).length, cr = xs.filter((r) => r.j.official.critical).length;
    return { label, n: v.length, mean: mean(v), ci: v.length >= 5 ? ci95(v) : null, p10: pct(v, 10), median: pct(v, 50), hard_fail: hf, critical: cr, clean_mean: mean(sc(xs.filter((r) => !r.j.official.hard_fail))) };
  };
  const show = (title, rowsOf, labels) => {
    console.log(`\n## ${title}\n| | n | mean | ±95 % | p10 | hard fails | critical | clean mean |\n|---|---:|---:|---:|---:|---:|---:|---:|`);
    const res = [];
    for (const l of labels) { const s = line(l, rowsOf(l)); if (!s) continue; res.push(s); console.log(`| ${l} | ${s.n} | ${f2(s.mean)} | ${s.ci == null ? '–' : f2(s.ci)} | ${f1(s.p10)} | ${s.hard_fail} | ${s.critical} | ${f2(s.clean_mean)} |`); }
    return res;
  };
  console.log(`\n# judged quality — set ${set}, judge ${judge}${judge === 'opus' ? ' (PROVISIONAL: Claude Opus 5.5; not the canonical gpt-6-astra series)' : ' (canonical)'}: ${judgedRecs.length} of ${answered.length} answered rows judged`);
  out.quality = {};
  out.quality.by_mode = show('by mode', (m) => judgedRecs.filter((r) => m === 'ALL' || r.item.mode === m), [...MODE_ORDER, 'ALL']);
  const delivered = (r) => r.fn.evidence_required && r.fn.evidence_delivered === true;
  const notDelivered = (r) => r.fn.evidence_required && r.fn.evidence_delivered === false;
  const groups = {
    'evidence required and delivered to the prompt': delivered, 'evidence required, NOT delivered': notDelivered,
    'missing evidence (deliberately absent)': (r) => r.item.condition === 'missing_evidence', 'irrelevant source': (r) => r.item.condition === 'irrelevant_source',
    'single source': (r) => r.item.condition === 'grounded_single', 'multi source': (r) => r.item.condition === 'multi_source',
    'conflict / stale': (r) => r.item.condition === 'conflict_stale', 'follow-up': (r) => r.item.condition === 'followup',
    'single source, delivered': (r) => r.item.condition === 'grounded_single' && delivered(r), 'multi source, delivered': (r) => r.item.condition === 'multi_source' && delivered(r), 'conflict / stale, delivered': (r) => r.item.condition === 'conflict_stale' && delivered(r),
    'read whole (small corpus)': (r) => r.fn.evidence_required && r.fn.read_whole, 'retrieved (large corpus)': (r) => r.fn.evidence_required && !r.fn.read_whole && r.fn.file_uploaded !== null,
  };
  out.quality.by_evidence = show('by evidence condition (all modes pooled)', (l) => judgedRecs.filter(groups[l]), Object.keys(groups));
  out.quality.delivered_by_mode = show('evidence delivered, by mode', (m) => judgedRecs.filter((r) => delivered(r) && (m === 'ALL' || r.item.mode === m)), [...MODE_ORDER, 'ALL']);
  out.quality.missing_by_mode = show('missing evidence, by mode', (m) => judgedRecs.filter((r) => r.item.condition === 'missing_evidence' && (m === 'ALL' || r.item.mode === m)), [...MODE_ORDER, 'ALL']);
  out.quality.conflict_by_mode = show('conflict / stale, by mode', (m) => judgedRecs.filter((r) => r.item.condition === 'conflict_stale' && (m === 'ALL' || r.item.mode === m)), [...MODE_ORDER, 'ALL']);
  const piG = ['resume_only', 'jd_only', 'resume_jd', 'resume_jd_relevant_ref', 'resume_jd_irrelevant_ref', 'profile_conflicting_ref', 'no_pi', 'profile_b'];
  for (const m of ['looking-for-work', 'technical-interview']) out.quality[`pi_${m}`] = show(`${m}: by Profile Intelligence condition`, (l) => judgedRecs.filter((r) => r.item.mode === m && r.item.pi_condition === l), piG);
  out.quality.by_profile = show('by loaded profile (both PI modes)', (l) => judgedRecs.filter((r) => PI_MODES.has(r.item.mode) && String(r.row.pi_state).split('-')[0] === l), ['A', 'B', 'none']);
  out.quality.cf = show('counterfactual variants by evidence state', (l) => judgedRecs.filter((r) => r.item.cf_family && (l === 'ALL' || (r.item.condition === l))), ['grounded_single', 'conflict_stale', 'missing_evidence', 'ALL']);
  // flags
  const flagCount = {};
  for (const r of judgedRecs) for (const f of r.j.official.flags) flagCount[f] = (flagCount[f] ?? 0) + 1;
  out.quality.flags = flagCount;
  console.log(`\n## flags (judge + objective), ${judgedRecs.length} judged rows\n${Object.entries(flagCount).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}${f in CAP_FLAGS ? '*' : ''} ${n}`).join(' · ')}\n(* carries a cap)`);
  const dis = judgedRecs.filter((r) => r.j.official.judge_disagreement);
  out.quality.judge_disagreement = dis.length;
  console.log(`objective check overruled the judge on ${dis.length} rows`);
  // root-cause split of hard fails, from the prompt
  const hard = judgedRecs.filter((r) => r.j.official.hard_fail);
  const cause = (r) => {
    if (r.fn.evidence_required && r.fn.file_parse_success === false) return 'A ingestion (file not parsed)';
    if (r.fn.evidence_required && r.fn.fact_survived_parse === false) return 'A ingestion (fact lost in parse)';
    if (r.fn.evidence_required && r.fn.pi_fact_reached_prompt === false && r.fn.doc_fact_reached_prompt !== false) return 'E/F profile evidence not in prompt';
    if (r.fn.evidence_required && r.fn.evidence_delivered === false) return r.fn.wrong_source_retrieved ? 'C wrong source selected' : 'B retrieval (fact not in prompt)';
    // A leak is a leak only when the other profile's / mode's text was in the prompt; otherwise the claim was invented.
    if (r.j.official.flags.some((f) => ['wrong_profile_used', 'pi_leak', 'cross_mode_reference_leak'].includes(f))) {
      return (r.fn.wrong_profile_reached_prompt || r.fn.cross_mode_source_in_prompt.length || r.fn.pi_in_forbidden_mode_prompt) ? 'F isolation / leakage (the other text was in the prompt)' : 'H generation: invented a claim that resembles another profile or mode (none of it was in the prompt)';
    }
    if (r.j.official.flags.some((f) => ['stale_source_preferred', 'draft_source_preferred', 'source_conflict_ignored'].includes(f))) return 'D precedence (evidence in prompt)';
    if (r.j.official.flags.some((f) => ['arithmetic_error', 'pricing_error'].includes(f))) return 'J arithmetic';
    if (r.j.official.flags.includes('code_incorrect')) return 'K coding';
    if (r.j.official.flags.some((f) => ['role_confusion', 'speaker_confusion'].includes(f))) return 'L role / speaker';
    if (r.item.condition === 'missing_evidence' || !r.fn.evidence_required) return 'H generation: invented where evidence is absent';
    return 'H generation: evidence in prompt, answer wrong';
  };
  const causes = {};
  for (const r of hard) { const c = cause(r); causes[c] = (causes[c] ?? 0) + 1; }
  out.quality.hard_fail_causes = causes;
  console.log(`\n## where the ${hard.length} hard fails come from (objective attribution)\n${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n}  ${c}`).join('\n')}`);
  if (!blind && worstN) {
    console.log(`\n## ${worstN} lowest-scoring rows`);
    for (const r of [...judgedRecs].sort((a, b) => a.j.official.overall - b.j.official.overall).slice(0, worstN)) {
      console.log(`- ${r.row.benchmark_id} [${r.item.mode} / ${r.item.condition}${r.item.pi_condition ? ' / ' + r.item.pi_condition : ''}] ${f1(r.j.official.overall)} ${r.j.official.flags.join(',')} | delivered: ${r.fn.evidence_delivered} | ${cause(r)}\n    Q: ${r.item.question.slice(0, 160)}\n    A: ${answerOf(r.row).replace(/\s+/g, ' ').slice(0, 260)}\n    judge: ${String(r.j.judgment.specific_issue ?? '').slice(0, 220)}`);
    }
  }
}
if (opt('json') && opt('json') !== true) fs.writeFileSync(path.resolve(opt('json')), JSON.stringify(out, null, 1));
