// benchmark/harness/analyze.mjs
// Joins pipeline outputs + provider wire logs + judge evaluations into per-run records
// (results/runs.jsonl, results/runs.csv) and aggregate tables (results/aggregates.json).
import fs from 'node:fs'
import path from 'node:path'

const BENCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
// BENCH_CONFIG_PATH / BENCH_RESULTS_DIR let a follow-up study (e.g. the 2026-09-17
// deepseek-flash migration regression) analyse its own configs without
// overwriting the main benchmark's results/.
const config = JSON.parse(fs.readFileSync(process.env.BENCH_CONFIG_PATH ? path.resolve(process.env.BENCH_CONFIG_PATH) : path.join(BENCH, 'config.json'), 'utf8'))
const RESULTS = process.env.BENCH_RESULTS_DIR ? path.resolve(process.env.BENCH_RESULTS_DIR) : path.join(BENCH, 'results')
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'manifest.json'), 'utf8'))
const CFG = Object.fromEntries(config.configs.map(c => [c.id, c]))
const CONV = Object.fromEntries(manifest.conversations.map(c => [c.id, c]))
const PRICE = config.pricing_usd_per_million
const DL = config.production_deadlines_ms

// ── wire logs ────────────────────────────────────────────────────────────────
const wireByReq = new Map()
for (const f of fs.readdirSync(path.join(BENCH, 'raw/wire'))) {
  for (const line of fs.readFileSync(path.join(BENCH, 'raw/wire', f), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const w = JSON.parse(line)
    if (!w.req_id) continue
    if (!wireByReq.has(w.req_id)) wireByReq.set(w.req_id, [])
    wireByReq.get(w.req_id).push(w)
  }
}

function isDeepSeekPeak(iso) {
  const d = new Date(iso)
  const day = d.getUTCDay()               // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return false
  const h = d.getUTCHours()
  return (h >= 1 && h < 4) || (h >= 6 && h < 10)
}

function callCost(w, cfg) {
  const u = w.usage || {}
  if (cfg.provider === 'deepseek') {
    const hit = u.prompt_cache_hit_tokens ?? 0
    const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit)
    const out = u.completion_tokens ?? 0
    const p = PRICE['deepseek-flash']
    const at = (tier) => (miss * tier.input_cache_miss + hit * tier.input_cache_hit + out * tier.output) / 1e6
    const cold = (tier) => ((miss + hit) * tier.input_cache_miss + out * tier.output) / 1e6
    return {
      input: miss + hit, cached: hit, output: out, reasoning: w.reasoning_tokens ?? 0,
      cost_billed: at(isDeepSeekPeak(w.ts_start) ? p.peak : p.off_peak),
      cost_offpeak: at(p.off_peak), cost_peak: at(p.peak),
      cost_cold_offpeak: cold(p.off_peak), cost_cold_peak: cold(p.peak),
      peak_window: isDeepSeekPeak(w.ts_start),
    }
  }
  const cached = u.input_tokens_details?.cached_tokens ?? 0
  const input = u.input_tokens ?? 0
  const out = u.output_tokens ?? 0
  const p = PRICE['gpt-5.6-luna']
  const billed = ((input - cached) * p.input + cached * p.cached_input + out * p.output) / 1e6
  const cold = (input * p.input + out * p.output) / 1e6
  return { input, cached, output: out, reasoning: w.reasoning_tokens ?? 0, cost_billed: billed, cost_offpeak: billed, cost_peak: billed, cost_cold_offpeak: cold, cost_cold_peak: cold, peak_window: null }
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
const sum = a => a.reduce((x, y) => x + y, 0)

const FACT_GROUPS = {
  numbers: ['number'], actions: ['action_item', 'commitment'], decisions: ['decision'],
  timeline: ['timeline', 'logistics'], entities: ['entity', 'person', 'background'],
  concepts: ['definition', 'concept', 'example', 'caveat', 'conclusion'],
  customer: ['pain_point', 'objection', 'requirement', 'preference'], risks_questions: ['risk', 'open_question'],
}
const IMPORTANCE_W = { critical: 3, important: 2, minor: 1 }

// ── per run ──────────────────────────────────────────────────────────────────
const runs = []
for (const cfgId of fs.readdirSync(path.join(BENCH, 'outputs'))) {
  const cfg = CFG[cfgId]
  if (!cfg) continue
  for (const convId of fs.readdirSync(path.join(BENCH, 'outputs', cfgId))) {
    const ref = fs.existsSync(path.join(BENCH, 'references', `${convId}.json`)) ? JSON.parse(fs.readFileSync(path.join(BENCH, 'references', `${convId}.json`), 'utf8')) : null
    for (const f of fs.readdirSync(path.join(BENCH, 'outputs', cfgId, convId))) {
      if (!f.endsWith('.json')) continue
      const label = f.replace(/\.crash\.json$|\.json$/, '')
      const crashed = f.endsWith('.crash.json')
      const r = JSON.parse(fs.readFileSync(path.join(BENCH, 'outputs', cfgId, convId, f), 'utf8'))
      const rec = {
        benchmark_id: config.benchmark_id, conversation_id: convId, category: CONV[convId]?.category, length_bucket: CONV[convId]?.length_bucket,
        config_id: cfgId, provider: cfg.provider, model: cfg.model, reasoning_effort: cfg.reasoning_effort, thinking_mode: cfg.thinking_mode,
        run: label, retry_of: r.job?.retry_of ?? null, crashed, started_at: r.started_at ?? null,
      }
      const calls = r.calls || []
      const fetches = r.fetches || []
      // wire join
      const reqToCall = new Map(fetches.filter(x => x.req_id).map(x => [x.req_id, x.call_id]))
      const modelCalls = [], blocked = []
      for (const [reqId] of reqToCall) for (const w of wireByReq.get(reqId) || []) {
        if (w.kind === 'MODEL_CALL') modelCalls.push({ ...w, call_id: reqToCall.get(reqId) })
        else if (w.kind === 'BLOCKED_FALLBACK') blocked.push({ ...w, call_id: reqToCall.get(reqId) })
      }
      const costs = modelCalls.filter(w => w.status === 200).map(w => ({ ...callCost(w, cfg), w }))
      rec.model_calls = modelCalls.length
      rec.model_call_errors = modelCalls.filter(w => w.status !== 200).length
      rec.infra_retries = sum(modelCalls.map(w => w.infra_retries || 0))
      rec.pipeline_calls = calls.length
      rec.pipeline_call_errors = calls.filter(c => c.error).length
      rec.repair_calls = calls.filter(c => c.stage.startsWith('repair:')).length
      rec.repair_chunk_calls = calls.filter(c => c.stage === 'repair:ChunkMeetingAtoms').length
      rec.chunk_calls = calls.filter(c => c.stage === 'chunk_extraction').length
      rec.blocked_fallback_attempts = blocked.length
      rec.blocked_fallback_calls = new Set(blocked.map(b => b.call_id)).size
      // A blocked fallback with NO model call for that request = production size gate
      // (EXTRACTION_DEEPSEEK_MAX_CHARS) or breaker routed it to Gemini before any candidate call.
      rec.calls_routed_away_by_production = new Set(blocked.filter(b => !modelCalls.some(m => m.call_id === b.call_id)).map(b => b.call_id)).size
      rec.electron_fallback_rungs_attempted = (r.contamination || []).filter(c => c.kind === 'fallback_rung_attempted' || c.kind === 'electron_external_fetch').length
      // tokens / cost
      rec.input_tokens = sum(costs.map(c => c.input)); rec.cached_input_tokens = sum(costs.map(c => c.cached))
      rec.output_tokens = sum(costs.map(c => c.output)); rec.reasoning_tokens = sum(costs.map(c => c.reasoning))
      rec.visible_output_tokens = rec.output_tokens - rec.reasoning_tokens
      rec.total_tokens = rec.input_tokens + rec.output_tokens
      for (const k of ['cost_billed', 'cost_offpeak', 'cost_peak', 'cost_cold_offpeak', 'cost_cold_peak']) rec[`${k}_usd`] = sum(costs.map(c => c[k]))
      rec.deepseek_peak_calls = costs.filter(c => c.peak_window === true).length
      // verification
      rec.response_models = [...new Set(modelCalls.map(w => w.response_model).filter(Boolean))]
      rec.upstream_models_requested = [...new Set(modelCalls.map(w => w.upstream_request_params?.model))]
      rec.echoed_efforts = [...new Set(modelCalls.map(w => w.echoed_reasoning?.effort).filter(Boolean))]
      rec.upstream_thinking = [...new Set(modelCalls.map(w => JSON.stringify(w.upstream_request_params?.thinking ?? null)))]
      rec.production_thinking = [...new Set(modelCalls.map(w => JSON.stringify(w.production_request_params?.thinking ?? null)))]
      const expectModel = cfg.provider === 'deepseek' ? (m => m === 'deepseek-flash') : (m => /^gpt-5\.6-luna/.test(m))
      rec.verify_model_ok = rec.response_models.length > 0 && rec.response_models.every(expectModel)
      rec.verify_reasoning_ok = cfg.provider === 'openai'
        ? (rec.echoed_efforts.length === 1 && rec.echoed_efforts[0] === cfg.reasoning_effort)
        : cfg.thinking === 'production'
          ? (rec.reasoning_tokens === 0 && rec.upstream_thinking.every(t => t === '{"type":"disabled"}'))
          : (rec.upstream_thinking.every(t => t === 'null') && rec.reasoning_tokens > 0)
      rec.verify_no_electron_fallback = rec.electron_fallback_rungs_attempted === 0
      rec.verify_all_outputs_from_candidate = rec.blocked_fallback_attempts === 0 && rec.verify_no_electron_fallback
      // timings
      const tl = r.timeline_ms || {}
      rec.pipeline_ms = tl.pipeline_end_ms != null ? tl.pipeline_end_ms - tl.pipeline_start_ms : null
      rec.assemble_ms = tl.assemble_end_ms != null ? tl.assemble_end_ms - tl.pipeline_start_ms : null   // V3 summary object ready (before title)
      rec.title_ms = tl.title_end_ms != null ? tl.title_end_ms - tl.title_start_ms : null
      const st = Object.fromEntries((r.status_times || []).map(s => [s.status, s.t_ms]))
      rec.chunk_phase_ms = st.reducing != null && st.summarizing_chunks != null ? st.reducing - st.summarizing_chunks : null
      rec.polish_followup_phase_ms = tl.assemble_end_ms != null && st.validating != null ? tl.assemble_end_ms - st.validating : null
      rec.model_time_serial_ms = sum(modelCalls.map(w => w.upstream_ms || 0))
      const successCalls = calls.filter(c => !c.error && c.t_end_ms != null)
      rec.max_call_ms = successCalls.length ? Math.max(...successCalls.map(c => c.t_end_ms - c.t_start_ms)) : null
      rec.ttft_ms = null   // production summary path is non-streaming (stream:false); no first-token event exists
      // production deadline compliance per call
      let violations = 0, extractionViolations = 0, headerViolations = 0
      for (const c of calls) {
        const ws = modelCalls.filter(w => w.call_id === c.call_id && w.status === 200)
        if (!ws.length) continue
        const up = Math.max(...ws.map(w => w.upstream_ms)), hdr = Math.max(...ws.map(w => w.headers_ms))
        const client = c.t_end_ms - c.t_start_ms
        const isExt = c.purpose === 'extraction'
        const v = (hdr > DL.server_undici_headers_timeout)
          || (isExt ? up > DL.server_extraction_deepseek_cap : up > DL.server_general_deepseek_cap)
          || (client > (isExt ? DL.electron_extraction_fetch_timeout : DL.electron_note_call_fetch_timeout))
        if (hdr > DL.server_undici_headers_timeout) headerViolations++
        if (v) { violations++; if (isExt) extractionViolations++ }
      }
      rec.prod_deadline_violations = violations
      rec.prod_deadline_extraction_violations = extractionViolations
      rec.prod_headers_timeout_violations = headerViolations
      // pipeline outcome
      const s = r.summary || {}
      rec.summary_produced = s.schemaVersion === 3
      const dropMsg = (s.generation?.warnings || []).find(x => /chunk\(s\) failed extraction/.test(x))
      rec.chunks_total = s.generation?.chunkCount ?? null
      rec.chunks_dropped = dropMsg ? Number(/^(\d+) of/.exec(dropMsg)[1]) : 0
      const ev = (r.events || []).map(e => e.msg)
      rec.polish_summary_rejected = ev.some(m => /Summary polish rejected/.test(m))
      rec.polish_overview_rejected = ev.some(m => /Overview polish rejected/.test(m))
      rec.title_source = r.title_source ?? null
      rec.sections = (s.sectionsV3 || []).length
      rec.section_bullets = sum((s.sectionsV3 || []).map(x => x.bullets.length))
      rec.action_items = (s.actionItemsV3 || []).length
      rec.decisions = (s.decisions || []).length
      rec.summary_chars = JSON.stringify({ o: s.overview, t: s.tldr, sec: s.sectionsV3?.map(x => x.bullets.map(b => b.text)) }).length
      // quality
      const evalPath = path.join(BENCH, 'evaluations', cfgId, convId, `${label}.json`)
      if (!crashed && fs.existsSync(evalPath) && ref) {
        const e = JSON.parse(fs.readFileSync(evalPath, 'utf8')).evaluation
        for (const k of ['factual_accuracy', 'important_information_retention', 'hallucination_control', 'action_item_retention', 'decision_retention', 'speaker_attribution', 'numeric_accuracy', 'entity_retention', 'timeline_accuracy', 'conclusion_accuracy', 'structure', 'conciseness', 'readability', 'overall_summary_quality']) rec[`q_${k}`] = e[k]
        const status = Object.fromEntries((e.fact_checks || []).map(x => [x.id, x.status]))
        const score = st => st === 'present' ? 1 : st === 'partial' ? 0.5 : 0
        const facts = ref.facts
        const wsum = (fs_) => { const w = sum(fs_.map(f => IMPORTANCE_W[f.importance] || 1)); return w ? sum(fs_.map(f => (IMPORTANCE_W[f.importance] || 1) * score(status[f.id]))) / w : null }
        const plain = (fs_) => fs_.length ? sum(fs_.map(f => score(status[f.id]))) / fs_.length : null
        rec.fact_retention_weighted = wsum(facts)
        rec.fact_retention_critical = plain(facts.filter(f => f.importance === 'critical'))
        rec.fact_retention_all = plain(facts)
        for (const [g, types] of Object.entries(FACT_GROUPS)) rec[`fact_retention_${g}`] = plain(facts.filter(f => types.includes(f.type)))
        for (const pos of ['early', 'middle', 'late']) rec[`fact_retention_pos_${pos}`] = plain(facts.filter(f => f.position === pos && f.importance !== 'minor'))
        rec.facts_contradicted = facts.filter(f => status[f.id] === 'contradicted').length
        rec.facts_unscored = facts.filter(f => !status[f.id]).length
        rec.critical_errors = (e.critical_errors || []).length
        rec.hallucinations = (e.hallucinated_information || []).length
        rec.superseded_values_reported = (e.superseded_values_reported || []).length
        rec.not_decisions_reported_as_decided = (e.not_decisions_reported_as_decided || []).length
        rec.distractors_included = (e.distractors_included || []).length
        rec.corrections_total = (ref.corrections || []).length
        const correctionFacts = (ref.corrections || []).map(c => c.fact_id).filter(Boolean)
        rec.correction_final_value_retention = correctionFacts.length ? plain(facts.filter(f => correctionFacts.includes(f.id))) : null
        rec.judged = true
      } else rec.judged = false
      runs.push(rec)
    }
  }
}

fs.mkdirSync(RESULTS, { recursive: true })
fs.writeFileSync(path.join(RESULTS, 'runs.jsonl'), runs.map(r => JSON.stringify(r)).join('\n') + '\n')
const cols = [...new Set(runs.flatMap(r => Object.keys(r)))]
const csvCell = v => v == null ? '' : Array.isArray(v) ? `"${v.join(';')}"` : typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v)
fs.writeFileSync(path.join(RESULTS, 'runs.csv'), [cols.join(','), ...runs.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n')

// ── selection: the run set used for aggregates ───────────────────────────────
// For each (config, conversation, runN): use the original run unless it was an INFRA failure
// (crash / candidate-provider HTTP or network error) and a retry exists, in which case the
// retry is used and flagged. Model-attributable failures (invalid JSON, dropped chunks,
// production size-gate routing) are never replaced.
const byKey = new Map()
for (const r of runs) { const base = r.run.replace(/-retry\d+$/, ''); const k = `${r.config_id}|${r.conversation_id}|${base}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r) }
const selected = []
const excluded = []
for (const [, list] of byKey) {
  const orig = list.find(r => !r.retry_of) || list[0]
  const retry = list.find(r => r.retry_of)
  // Infra failure = crash, a candidate-provider HTTP/network error that survived the shim's
  // retries (e.g. the OpenAI account running out of credits mid-benchmark), or no summary at all
  // (every observed case was the provider breaker cooling after those 429s). Invalid-JSON /
  // size-gate chunk drops are model-attributable and stay in.
  const infraFail = r => r.crashed || r.model_call_errors > 0 || !r.summary_produced
  if (infraFail(orig) && retry && !infraFail(retry)) selected.push({ ...retry, used_retry: true })
  else if (infraFail(orig)) excluded.push({ config_id: orig.config_id, conversation_id: orig.conversation_id, run: orig.run, reason: orig.crashed ? 'crash' : orig.model_call_errors > 0 ? 'provider_error' : 'no_summary', model_call_errors: orig.model_call_errors, retry_attempted: !!retry })
  else selected.push({ ...orig, used_retry: false })
}
fs.writeFileSync(path.join(RESULTS, 'runs-selected.jsonl'), selected.map(r => JSON.stringify(r)).join('\n') + '\n')
fs.writeFileSync(path.join(RESULTS, 'runs-excluded.json'), JSON.stringify(excluded, null, 1))

// ── aggregates ───────────────────────────────────────────────────────────────
const QK = ['q_overall_summary_quality', 'q_factual_accuracy', 'q_important_information_retention', 'q_hallucination_control', 'q_action_item_retention', 'q_decision_retention', 'q_speaker_attribution', 'q_numeric_accuracy', 'q_entity_retention', 'q_timeline_accuracy', 'q_conclusion_accuracy', 'q_structure', 'q_conciseness', 'q_readability',
  'fact_retention_weighted', 'fact_retention_critical', 'fact_retention_all', ...Object.keys(FACT_GROUPS).map(g => `fact_retention_${g}`), 'fact_retention_pos_early', 'fact_retention_pos_middle', 'fact_retention_pos_late', 'correction_final_value_retention',
  'facts_contradicted', 'critical_errors', 'hallucinations', 'superseded_values_reported', 'not_decisions_reported_as_decided', 'distractors_included']
const NK = ['pipeline_ms', 'assemble_ms', 'title_ms', 'chunk_phase_ms', 'polish_followup_phase_ms', 'model_time_serial_ms', 'max_call_ms', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'visible_output_tokens', 'total_tokens',
  'cost_billed_usd', 'cost_offpeak_usd', 'cost_peak_usd', 'cost_cold_offpeak_usd', 'cost_cold_peak_usd', 'model_calls', 'repair_calls', 'repair_chunk_calls', 'chunks_dropped', 'infra_retries', 'prod_deadline_violations', 'prod_headers_timeout_violations', 'calls_routed_away_by_production', 'section_bullets', 'action_items', 'decisions', 'summary_chars']

function stats(rows, k) {
  const v = rows.map(r => r[k]).filter(x => typeof x === 'number' && Number.isFinite(x))
  return v.length ? { n: v.length, mean: mean(v), median: pct(v, 0.5), p90: pct(v, 0.9), min: Math.min(...v), max: Math.max(...v) } : { n: 0 }
}
function groupAgg(rows, keyFn) {
  const out = {}
  for (const r of rows) { const k = keyFn(r); (out[k] ||= []).push(r) }
  return Object.fromEntries(Object.entries(out).map(([k, rs]) => [k, {
    runs: rs.length, judged: rs.filter(r => r.judged).length,
    summary_failures: rs.filter(r => !r.summary_produced).length,
    polish_summary_rejected_rate: rs.filter(r => r.polish_summary_rejected).length / rs.length,
    polish_overview_rejected_rate: rs.filter(r => r.polish_overview_rejected).length / rs.length,
    runs_with_dropped_chunks: rs.filter(r => r.chunks_dropped > 0).length,
    runs_with_prod_deadline_violation: rs.filter(r => r.prod_deadline_violations > 0).length,
    runs_routed_away_by_production: rs.filter(r => r.calls_routed_away_by_production > 0).length,
    verify_model_ok: rs.filter(r => r.verify_model_ok).length, verify_reasoning_ok: rs.filter(r => r.verify_reasoning_ok).length,
    verify_no_electron_fallback: rs.filter(r => r.verify_no_electron_fallback).length,
    ...Object.fromEntries([...QK, ...NK].map(q => [q, stats(rs, q)])),
  }]))
}

// Bootstrap CI over conversations for the per-conversation mean (config-level), and paired
// difference vs the production DeepSeek config.
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
function convMeans(rows, k) {
  const by = {}
  for (const r of rows) if (typeof r[k] === 'number') (by[r.conversation_id] ||= []).push(r[k])
  return Object.fromEntries(Object.entries(by).map(([c, v]) => [c, mean(v)]))
}
function bootstrap(values, B = 4000, seed = 7) {
  const rnd = seeded(seed); const n = values.length; if (!n) return null
  const ms = []
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(rnd() * n)]; ms.push(s / n) }
  return { mean: mean(values), lo: pct(ms, 0.025), hi: pct(ms, 0.975) }
}
const CI = {}
for (const k of ['q_overall_summary_quality', 'fact_retention_weighted', 'fact_retention_critical', 'q_factual_accuracy', 'q_hallucination_control', 'pipeline_ms', 'cost_cold_offpeak_usd']) {
  CI[k] = {}
  const base = convMeans(selected.filter(r => r.config_id === 'ds-flash-prod'), k)
  for (const cfgId of Object.keys(CFG)) {
    const m = convMeans(selected.filter(r => r.config_id === cfgId), k)
    const common = Object.keys(m).filter(c => c in base)
    CI[k][cfgId] = { ci: bootstrap(Object.values(m)), paired_diff_vs_ds_prod: cfgId === 'ds-flash-prod' ? null : bootstrap(common.map(c => m[c] - base[c])), conversations: Object.keys(m).length }
  }
}

const aggregates = {
  generated_at: new Date().toISOString(),
  totals: { runs_on_disk: runs.length, selected_runs: selected.length, retries_used: selected.filter(r => r.used_retry).length, excluded_infra_failures: excluded.length, excluded },
  by_config: groupAgg(selected, r => r.config_id),
  by_config_category: groupAgg(selected, r => `${r.config_id}|${r.category}`),
  by_config_length: groupAgg(selected, r => `${r.config_id}|${r.length_bucket}`),
  by_config_conversation: groupAgg(selected, r => `${r.config_id}|${r.conversation_id}`),
  ci: CI,
}
fs.writeFileSync(path.join(RESULTS, 'aggregates.json'), JSON.stringify(aggregates, null, 1))
console.log(`runs=${runs.length} selected=${selected.length} judged=${selected.filter(r => r.judged).length}`)
for (const [k, v] of Object.entries(aggregates.by_config)) console.log(k.padEnd(18), `runs=${v.runs} judged=${v.judged} fail=${v.summary_failures} q=${v.q_overall_summary_quality.mean?.toFixed(2)} ret=${v.fact_retention_weighted.mean?.toFixed(3)} p50=${(v.pipeline_ms.median / 1000)?.toFixed(1)}s p90=${(v.pipeline_ms.p90 / 1000)?.toFixed(1)}s cost=$${v.cost_cold_offpeak_usd.mean?.toFixed(5)} model_ok=${v.verify_model_ok} reas_ok=${v.verify_reasoning_ok}`)
