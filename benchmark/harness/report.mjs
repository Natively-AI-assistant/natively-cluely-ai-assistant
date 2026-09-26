// Generates benchmark/reports/REPORT.md. Every number in a table comes from
// results/aggregates.json (computed by analyze.mjs). Narrative sections are read from
// reports/narrative/<section>.md (written after reading the data) and inserted verbatim.
import fs from 'node:fs'
import path from 'node:path'

const BENCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const agg = JSON.parse(fs.readFileSync(path.join(BENCH, 'results/aggregates.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(BENCH, 'config.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'manifest.json'), 'utf8'))
const sel = fs.readFileSync(path.join(BENCH, 'results/runs-selected.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const ORDER = ['ds-flash-prod', 'ds-flash-thinking', 'luna-max', 'luna-medium', 'luna-low', 'luna-none']
const LABEL = { 'ds-flash-prod': 'DeepSeek V4.1 Flash — current Natively (thinking off)', 'ds-flash-thinking': 'DeepSeek V4.1 Flash — thinking ON (diagnostic)', 'luna-max': 'GPT-5.6 Luna — max', 'luna-medium': 'GPT-5.6 Luna — medium', 'luna-low': 'GPT-5.6 Luna — low', 'luna-none': 'GPT-5.6 Luna — none' }
const SHORT = { 'ds-flash-prod': 'DS Flash (current)', 'ds-flash-thinking': 'DS Flash thinking', 'luna-max': 'Luna max', 'luna-medium': 'Luna medium', 'luna-low': 'Luna low', 'luna-none': 'Luna none' }
const narrative = (name) => { const p = path.join(BENCH, 'reports/narrative', `${name}.md`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : `_(narrative "${name}" not written)_` }

const f1 = x => x == null || Number.isNaN(x) ? '—' : x.toFixed(1)
const f2 = x => x == null || Number.isNaN(x) ? '—' : x.toFixed(2)
const pctf = x => x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`
const sec = ms => ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`
const int = x => x == null ? '—' : Math.round(x).toLocaleString('en-US')
const usd = (x, d = 4) => x == null ? '—' : `$${x < 1 ? x.toFixed(d) : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const nj = (x, fn) => !x || !x.judged ? '— (n=0)' : x.judged < 3 ? `${fn(x)} (n=${x.judged})` : fn(x)
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
const C = id => agg.by_config[id]
const g = (key, metric, stat = 'mean') => agg[key.startsWith('by_') ? key : 'by_config'][metric]
const cell = (obj, metric, stat = 'mean') => obj?.[metric]?.[stat]

// blended DeepSeek price: peak windows are 7h x 5 weekdays = 35 of 168 weekly hours
const PEAK_SHARE = 35 / 168
const blended = id => {
  const c = C(id)
  if (!c) return null
  return id.startsWith('ds') ? PEAK_SHARE * c.cost_cold_peak_usd.mean + (1 - PEAK_SHARE) * c.cost_cold_offpeak_usd.mean : c.cost_cold_offpeak_usd.mean
}

const L = []
L.push(`# Natively summary-model benchmark — DeepSeek V4.1 Flash vs GPT-5.6 Luna`, '')
L.push(`Benchmark id \`${config.benchmark_id}\` · generated ${agg.generated_at} · ${agg.totals.selected_runs} summary runs used (${agg.totals.excluded_infra_failures} excluded as infra failures, ${agg.totals.retries_used} retries used) · ${manifest.conversations.length} conversations × ${ORDER.length} configurations × ${config.runs_per_pair} runs`, '')
L.push('# Executive Summary', '', narrative('executive-summary'), '')
L.push('# Current Natively Configuration', '', narrative('current-config'), '')

L.push('# Benchmark Corpus', '')
L.push(table(['ID', 'Type', 'Mode', 'Length', 'Duration', 'Words', 'Tokens (chars/4)', 'Speakers', 'Source'], manifest.conversations.map(c => [c.id, c.category, c.natively_mode, c.length_bucket, `${c.duration_min} min`, int(c.words), int(c.token_estimate_chars_div_4), c.speaker_count, c.source === 'youtube' ? `[YouTube](${c.source_url})` : 'synthetic'])))
L.push('', `Measured provider input tokens per summary (all calls, DeepSeek tokenizer, current config): see Token Usage. Full per-conversation metadata: \`benchmark/manifest.json\`.`, '')
L.push(narrative('corpus'), '')

L.push('# Model Configuration', '')
L.push(table(['Config id', 'Model', 'Effort', 'Thinking', 'Provider', 'API surface'], config.configs.map(c => [c.id, c.model, c.reasoning_effort ?? '—', c.thinking_mode, c.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI', c.provider === 'deepseek' ? 'POST api.deepseek.com/chat/completions (production body)' : 'POST api.openai.com/v1/responses'])))
L.push('', narrative('config-differences'), '')

L.push('# Verification', '')
L.push(table(['Config', 'Runs', 'Response model as expected', 'Reasoning setting reached provider', 'No Electron fallback', 'Runs with blocked server fallback', 'Summary failures'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], c.runs, `${c.verify_model_ok}/${c.runs}`, `${c.verify_reasoning_ok}/${c.runs}`, `${c.verify_no_electron_fallback}/${c.runs}`, c.runs_routed_away_by_production, c.summary_failures] })))
L.push('', narrative('verification'), '')

L.push('# Latency', '')
L.push('Production summary calls are non-streaming (`stream:false`), so no first-token event exists on this path: **TTFT is N/A for every configuration** (reported as such, not approximated). "E2E" = full post-meeting pipeline: chunk extraction → reduce → validate → 2 polish calls → follow-up draft → title → post-call enhancements. "V3 ready" = summary object ready before title generation.', '')
L.push(table(['Model', 'TTFT', 'P50 E2E', 'P90 E2E', 'Mean E2E', 'Max E2E', 'P50 V3 ready', 'P50 chunk phase', 'P50 slowest single call'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], 'N/A', sec(c.pipeline_ms.median), sec(c.pipeline_ms.p90), sec(c.pipeline_ms.mean), sec(c.pipeline_ms.max), sec(c.assemble_ms.median), sec(c.chunk_phase_ms.median), sec(c.max_call_ms.median)] })))
L.push('', '**P50 end-to-end by transcript length**', '')
const buckets = ['short', 'medium', 'long', 'very_long']
L.push(table(['Model', ...buckets.map(b => `${b} P50`), ...buckets.map(b => `${b} P90`)], ORDER.filter(C).map(id => [SHORT[id], ...buckets.map(b => sec(agg.by_config_length[`${id}|${b}`]?.pipeline_ms?.median)), ...buckets.map(b => sec(agg.by_config_length[`${id}|${b}`]?.pipeline_ms?.p90))])))
L.push('', '**Production deadline compliance** (deadlines were lifted during measurement so every configuration produced output; this counts calls that would have hit a real production limit and been replaced by the Gemini fallback or failed)', '')
L.push(table(['Model', 'Runs with ≥1 violation', 'Mean violating calls / run', 'of which undici 30s headers timeout', 'Runs routed away by 25k-char size gate'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], `${c.runs_with_prod_deadline_violation}/${c.runs}`, f2(c.prod_deadline_violations.mean), f2(c.prod_headers_timeout_violations.mean), `${c.runs_routed_away_by_production}/${c.runs}`] })))
L.push('', narrative('latency'), '')

L.push('# Token Usage', '', 'Mean per summary (all LLM calls in one post-meeting pipeline). Reasoning tokens are a subset of output tokens.', '')
L.push(table(['Model', 'Input', 'Cached', 'Output', 'Reasoning', 'Visible output', 'LLM calls', 'Repair calls'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], int(c.input_tokens.mean), int(c.cached_input_tokens.mean), int(c.output_tokens.mean), int(c.reasoning_tokens.mean), int(c.visible_output_tokens.mean), f1(c.model_calls.mean), f2(c.repair_calls.mean)] })))
L.push('', narrative('tokens'), '')

L.push('# Actual Cost', '')
L.push(`Computed from each call's provider-reported usage × current list price (${config.pricing_usd_per_million['deepseek-flash'].source}, ${config.pricing_usd_per_million['gpt-5.6-luna'].source}; checked ${config.pricing_usd_per_million.source_checked}). **Primary metric = cold-cache price** (all input billed as uncached): every real meeting is unique, whereas benchmark repeats of the same transcript hit provider prompt caches. DeepSeek blended = ${(PEAK_SHARE * 100).toFixed(1)}% peak / ${(100 - PEAK_SHARE * 100).toFixed(1)}% off-peak (uniform traffic across the week).`, '')
L.push(table(['Model', '$/summary (blended)', '$/1k', '$/10k', '$/100k', '$/1M', 'Median $/summary', 'P90 $/summary'], ORDER.filter(C).map(id => { const c = C(id); const b = blended(id); return [SHORT[id], usd(b, 5), usd(b * 1e3, 2), usd(b * 1e4, 2), usd(b * 1e5, 2), usd(b * 1e6, 2), usd(c.cost_cold_offpeak_usd.median, 5) + (id.startsWith('ds') ? ' (off-peak)' : ''), usd(c.cost_cold_offpeak_usd.p90, 5) + (id.startsWith('ds') ? ' (off-peak)' : '')] })))
L.push('', table(['Model', 'Cold off-peak $/summary', 'Cold peak $/summary', 'As billed in this benchmark (with cache hits)', 'Cost vs current DS Flash (blended)'], ORDER.filter(C).map(id => { const c = C(id); const r = blended(id) / blended('ds-flash-prod'); return [SHORT[id], usd(c.cost_cold_offpeak_usd.mean, 5), usd(c.cost_cold_peak_usd.mean, 5), usd(c.cost_billed_usd.mean, 5), `${r.toFixed(2)}×`] })))
L.push('', narrative('cost'), '')

L.push('# Quality', '')
L.push('Judge: `gemini-3.1-pro-preview` (neither candidate family), blind (opaque ids; no model/effort/price/latency), temperature 0, given the numbered transcript + gold fact sheet + one candidate. Scores 1–10. "Fact retention" = judge per-fact verdicts vs the gold fact sheet (present = 1, partial = 0.5), importance-weighted critical 3 / important 2 / minor 1. 95% CIs bootstrap over conversations.', '')
L.push(table(['Model', 'Judged runs', 'Overall', 'Accuracy', 'Retention (judge)', 'Fact retention (weighted)', 'Critical facts', 'Hallucination control', 'Actions', 'Decisions', 'Structure'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], `${c.judged}/${c.runs}`, f2(c.q_overall_summary_quality.mean), f2(c.q_factual_accuracy.mean), f2(c.q_important_information_retention.mean), pctf(c.fact_retention_weighted.mean), pctf(c.fact_retention_critical.mean), f2(c.q_hallucination_control.mean), f2(c.q_action_item_retention.mean), f2(c.q_decision_retention.mean), f2(c.q_structure.mean)] })))
L.push('', '**All judge dimensions (mean)**', '')
const dims = ['speaker_attribution', 'numeric_accuracy', 'entity_retention', 'timeline_accuracy', 'conclusion_accuracy', 'conciseness', 'readability']
L.push(table(['Model', ...dims], ORDER.filter(C).map(id => [SHORT[id], ...dims.map(d => f2(C(id)[`q_${d}`].mean))])))
L.push('', '**Uncertainty and paired comparison vs current DeepSeek config** (per-conversation means; paired difference = config − DS Flash current, bootstrap 95% CI over conversations)', '')
L.push(table(['Model', 'Overall [95% CI]', 'Δ overall vs current [95% CI]', 'Fact retention [95% CI]', 'Δ fact retention vs current [95% CI]', 'Δ critical-fact retention [95% CI]'], ORDER.filter(C).map(id => {
  const ci = (k) => agg.ci[k][id]
  const fmt = (x, p) => x ? (p ? `${pctf(x.mean)} [${pctf(x.lo)}, ${pctf(x.hi)}]` : `${f2(x.mean)} [${f2(x.lo)}, ${f2(x.hi)}]`) : '—'
  const fmtd = (x, p) => x ? (p ? `${(x.mean * 100).toFixed(1)} pp [${(x.lo * 100).toFixed(1)}, ${(x.hi * 100).toFixed(1)}]` : `${f2(x.mean)} [${f2(x.lo)}, ${f2(x.hi)}]`) : '—'
  return [SHORT[id], fmt(ci('q_overall_summary_quality').ci), fmtd(ci('q_overall_summary_quality').paired_diff_vs_ds_prod), fmt(ci('fact_retention_weighted').ci, true), fmtd(ci('fact_retention_weighted').paired_diff_vs_ds_prod, true), fmtd(ci('fact_retention_critical').paired_diff_vs_ds_prod, true)]
})))
const cs = JSON.parse(fs.readFileSync(path.join(BENCH, 'results/common-subset.json'), 'utf8'))
L.push('', `**Robustness check — common conversation set** (the ${cs.conversations.length} conversations where every configuration has ≥1 judged run: ${cs.conversations.join(', ')}). Luna max lost 13 runs to OpenAI credit exhaustion, leaving it with no judged run of CASUAL-M or TEAM-M, two conversations where the other Luna configurations performed worst; this table removes that coverage bias.`, '')
L.push(table(['Model', 'Runs (judged)', 'Fact retention (weighted)', 'Critical facts', 'Overall', 'Contradicted facts', 'P50 E2E', 'Δ fact retention vs current', 'Conversations worse than current'], ORDER.map(id => { const c = cs.by_config[id]; return [SHORT[id], `${c.runs} (${c.judged})`, pctf(c.fact_retention_weighted), pctf(c.fact_retention_critical), f2(c.q_overall_summary_quality), f2(c.facts_contradicted), sec(c.pipeline_ms_p50), c.paired_diff_fact_retention_vs_ds_prod == null ? '—' : `${(c.paired_diff_fact_retention_vs_ds_prod * 100).toFixed(1)} pp`, c.conversations_where_worse_than_ds_prod == null ? '—' : `${c.conversations_where_worse_than_ds_prod}/${cs.conversations.length}`] })))
L.push('', '**Summary-specific failure counts (mean per summary)**', '')
L.push(table(['Model', 'Contradicted facts', 'Critical errors', 'Hallucinations', 'Superseded value reported', 'Suggestion reported as decision', 'Distractors included', 'Correction final-value retention'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], f2(c.facts_contradicted.mean), f2(c.critical_errors.mean), f2(c.hallucinations.mean), f2(c.superseded_values_reported.mean), f2(c.not_decisions_reported_as_decided.mean), f2(c.distractors_included.mean), pctf(c.correction_final_value_retention.mean)] })))
L.push('', '**Retention by fact type**', '')
const groups = ['numbers', 'actions', 'decisions', 'timeline', 'entities', 'customer', 'risks_questions', 'concepts']
L.push(table(['Model', ...groups], ORDER.filter(C).map(id => [SHORT[id], ...groups.map(gp => pctf(C(id)[`fact_retention_${gp}`].mean))])))
L.push('', '**Distributed-information test: retention of critical+important facts by position in the transcript**', '')
L.push(table(['Model', 'Early third', 'Middle third', 'Final third'], ORDER.filter(C).map(id => [SHORT[id], pctf(C(id).fact_retention_pos_early.mean), pctf(C(id).fact_retention_pos_middle.mean), pctf(C(id).fact_retention_pos_late.mean)])))
L.push('', '**Pipeline behaviour per model (same prompts, same code)**', '')
L.push(table(['Model', 'Summary-polish rejected by "no new tokens" gate', 'Overview-polish rejected', 'Runs with dropped chunks', 'Chunk-JSON repair calls / run', 'Section bullets', 'Action items', 'Decisions'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], pctf(c.polish_summary_rejected_rate), pctf(c.polish_overview_rejected_rate), `${c.runs_with_dropped_chunks}/${c.runs}`, f2(c.repair_chunk_calls.mean), f1(c.section_bullets.mean), f1(c.action_items.mean), f1(c.decisions.mean)] })))
L.push('', narrative('quality'), '')

const cats = [...new Set(manifest.conversations.map(c => c.category))]
L.push('# Quality by Conversation Type', '', 'Mean over judged runs; cells with fewer than 3 judged runs show n.', '')
L.push(table(['Model', ...cats.map(c => `${c} overall`), ...cats.map(c => `${c} fact ret.`)], ORDER.filter(C).map(id => [SHORT[id], ...cats.map(c => nj(agg.by_config_category[`${id}|${c}`], x => f2(x?.q_overall_summary_quality?.mean))), ...cats.map(c => nj(agg.by_config_category[`${id}|${c}`], x => pctf(x?.fact_retention_weighted?.mean)))])))
L.push('', narrative('by-type'), '')

L.push('# Quality by Transcript Length', '', 'Mean over judged runs; cells with fewer than 3 judged runs show n. Buckets: short = SALES-S, TEAM-S (7-9 min); medium = INT-M, CASUAL-M (27-28 min); long = TEAM-M, INT-TECH-L, SALES-DISC-L, TECH-DISC-L, REAL-LECT-L (49-65 min); very long = LECT-VL, REAL-LECT-VL (90-99 min).', '')
L.push(table(['Model', ...buckets.map(b => `${b} overall`), ...buckets.map(b => `${b} fact ret.`), ...buckets.map(b => `${b} critical`)], ORDER.filter(C).map(id => [SHORT[id], ...buckets.map(b => nj(agg.by_config_length[`${id}|${b}`], x => f2(x?.q_overall_summary_quality?.mean))), ...buckets.map(b => nj(agg.by_config_length[`${id}|${b}`], x => pctf(x?.fact_retention_weighted?.mean))), ...buckets.map(b => nj(agg.by_config_length[`${id}|${b}`], x => pctf(x?.fact_retention_critical?.mean)))])))
L.push('', narrative('by-length'), '')

L.push('# Per-conversation results', '')
L.push(table(['Conversation', ...ORDER.map(id => SHORT[id])], manifest.conversations.map(cv => [cv.id, ...ORDER.map(id => { const x = agg.by_config_conversation[`${id}|${cv.id}`]; return x ? `${f1(x.q_overall_summary_quality.mean)} · ${pctf(x.fact_retention_weighted.mean)} · ${sec(x.pipeline_ms.median)}` : '—' })])))
L.push('', 'Cell = mean overall score (judged runs) · mean weighted fact retention (judged runs) · median E2E latency (all selected runs; Luna max has 1-3).', '')

L.push('# Failure Analysis', '', narrative('failure-analysis'), '')
L.push('# Cost / Quality / Latency Tradeoff', '')
L.push(table(['Model', 'Overall', 'Fact retention', 'P50 E2E', 'P90 E2E', '$/summary (blended)', '$/1M summaries', 'Cost vs current'], ORDER.filter(C).map(id => { const c = C(id); return [SHORT[id], f2(c.q_overall_summary_quality.mean), pctf(c.fact_retention_weighted.mean), sec(c.pipeline_ms.median), sec(c.pipeline_ms.p90), usd(blended(id), 5), usd(blended(id) * 1e6, 0), `${(blended(id) / blended('ds-flash-prod')).toFixed(2)}×`] })))
L.push('', narrative('tradeoff'), '')
L.push('# Requirements Screening', '', narrative('requirements'), '')
L.push('# Does the current Natively prompt cause model-specific differences?', '', narrative('prompt-effects'), '')
L.push('# Method, Fairness and Limitations', '', narrative('method'), '')
L.push('# Files', '', narrative('files'), '')
fs.writeFileSync(path.join(BENCH, 'reports/REPORT.md'), L.join('\n') + '\n')
console.log('REPORT.md written')
