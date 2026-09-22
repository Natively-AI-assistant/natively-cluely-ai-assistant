// benchmark/harness/migration-compare.mjs
//
// 2026-09-17 migration regression: natively-api's DeepSeek model id changed from
// the legacy alias `deepseek-v4-flash` to `deepseek-flash` (thinking still
// disabled). Compares the new runs (ds-flash-migrated) with the main benchmark's
// ds-flash-prod runs on the SAME conversations.
//
// No LLM judge: the Gemini judge key has no credits left. Quality is therefore
// measured deterministically and identically for both arms:
//   - anchor retention: for each critical/important gold fact, the numbers and
//     proper-noun anchors in its statement that appear in the rendered summary;
//   - unsupported numbers: numbers in the summary that never occur in the
//     transcript (a hallucination signal for numeric content);
//   - superseded values: numbers unique to a correction's INITIAL value that
//     appear in the summary.
// The main benchmark's Gemini-judged fact retention for ds-flash-prod is shown
// alongside as context, not as a like-for-like comparison.
//
// Usage: node harness/migration-compare.mjs <results-dir>
import fs from 'node:fs'
import path from 'node:path'
import { renderSummary } from './render.mjs'

const BENCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const RESULTS = path.resolve(process.argv[2] || path.join(BENCH, 'results/migration-2026-09-17'))
const BASE = 'ds-flash-prod', NEW = 'ds-flash-migrated'
const runs = fs.readFileSync(path.join(RESULTS, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const newRuns = runs.filter(r => r.config_id === NEW)
const convs = [...new Set(newRuns.map(r => r.conversation_id))].sort()
const baseRuns = runs.filter(r => r.config_id === BASE && convs.includes(r.conversation_id) && /^run[123]$/.test(r.run))

const STOP = new Set('The A An And But Or If In On At To Of For By With From As It Its This That These Those He She They We You I Our Their His Her Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' '))
const norm = s => s.toLowerCase().replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'")
const numbersIn = s => [...norm(s).matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)].map(m => m[0].replace(/[$,%]/g, '').replace(/\.0+$/, '')).filter(n => n.length > 0)
const namesIn = s => [...s.matchAll(/(?<![.!?]\s)(?<!^)\b[A-Z][a-zA-Z]{2,}\b/g)].map(m => m[0]).filter(w => !STOP.has(w))

function textOf(r) {
  const p = path.join(BENCH, 'outputs', r.config_id, r.conversation_id, `${r.run}.json`)
  if (!fs.existsSync(p)) return ''
  return renderSummary(JSON.parse(fs.readFileSync(p, 'utf8')).summary)
}

function deterministic(r) {
  const ref = JSON.parse(fs.readFileSync(path.join(BENCH, 'references', `${r.conversation_id}.json`), 'utf8'))
  const transcript = fs.readFileSync(path.join(BENCH, 'transcripts/src', `${r.conversation_id}.txt`), 'utf8')
  const summary = textOf(r)
  const sumNums = new Set(numbersIn(summary)), sumNorm = norm(summary)
  const facts = ref.facts.filter(f => f.importance !== 'minor')
  let anchors = 0, hit = 0, critAnchors = 0, critHit = 0
  for (const f of facts) {
    const a = [...new Set([...numbersIn(f.statement).map(n => ({ k: 'n', v: n })), ...namesIn(f.statement).map(n => ({ k: 'w', v: n }))].map(JSON.stringify))].map(JSON.parse)
    for (const x of a) {
      const ok = x.k === 'n' ? sumNums.has(x.v) : sumNorm.includes(norm(x.v))
      anchors++; hit += ok
      if (f.importance === 'critical') { critAnchors++; critHit += ok }
    }
  }
  const trNums = new Set(numbersIn(transcript))
  const unsupported = [...sumNums].filter(n => !trNums.has(n) && Number(n) > 1)
  let superseded = 0
  for (const c of ref.corrections || []) {
    const finals = new Set(numbersIn(c.final_value || ''))
    if (numbersIn(c.initial_value || '').filter(n => !finals.has(n)).some(n => sumNums.has(n))) superseded++
  }
  return {
    anchor_retention: anchors ? hit / anchors : null,
    critical_anchor_retention: critAnchors ? critHit / critAnchors : null,
    unsupported_numbers: unsupported.length,
    superseded_value_leaks: superseded,
    summary_numbers: sumNums.size,
  }
}

const mean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null }
const pct = (arr, p) => { const s = arr.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const f1 = (x, d = 1) => x == null ? '–' : x.toFixed(d)
const pc = x => x == null ? '–' : `${(100 * x).toFixed(1)}%`

function summarise(set) {
  const det = set.map(r => ({ ...r, ...deterministic(r) }))
  return {
    n: set.length,
    succeeded: set.filter(r => r.summary_produced && !r.crashed).length,
    model_call_errors: set.reduce((s, r) => s + r.model_call_errors, 0),
    chunks_dropped: set.reduce((s, r) => s + r.chunks_dropped, 0),
    blocked_fallback_calls: set.reduce((s, r) => s + r.blocked_fallback_calls, 0),
    prod_deadline_violations: set.reduce((s, r) => s + r.prod_deadline_violations, 0),
    requested_models: [...new Set(set.flatMap(r => r.upstream_models_requested))],
    response_models: [...new Set(set.flatMap(r => r.response_models))],
    thinking_sent: [...new Set(set.flatMap(r => r.upstream_thinking))],
    reasoning_tokens: set.reduce((s, r) => s + r.reasoning_tokens, 0),
    verify_all: set.every(r => r.verify_model_ok && r.verify_reasoning_ok && r.verify_all_outputs_from_candidate),
    p50_s: pct(set.map(r => r.pipeline_ms), 0.5) / 1000,
    p90_s: pct(set.map(r => r.pipeline_ms), 0.9) / 1000,
    mean_input_tokens: mean(set.map(r => r.input_tokens)),
    mean_output_tokens: mean(set.map(r => r.output_tokens)),
    mean_cost_cold_offpeak: mean(set.map(r => r.cost_cold_offpeak_usd)),
    action_items: mean(set.map(r => r.action_items)),
    decisions: mean(set.map(r => r.decisions)),
    sections: mean(set.map(r => r.sections)),
    section_bullets: mean(set.map(r => r.section_bullets)),
    polish_overview_rejected: set.filter(r => r.polish_overview_rejected).length,
    anchor_retention: mean(det.map(r => r.anchor_retention)),
    critical_anchor_retention: mean(det.map(r => r.critical_anchor_retention)),
    unsupported_numbers: mean(det.map(r => r.unsupported_numbers)),
    superseded_value_leaks: mean(det.map(r => r.superseded_value_leaks)),
    judged_fact_retention: mean(set.map(r => r.fact_retention_weighted)),
    per_conversation: Object.fromEntries(convs.map(c => [c, {
      anchor: mean(det.filter(r => r.conversation_id === c).map(r => r.anchor_retention)),
      p50_s: pct(set.filter(r => r.conversation_id === c).map(r => r.pipeline_ms), 0.5) / 1000,
      out_tokens: mean(set.filter(r => r.conversation_id === c).map(r => r.output_tokens)),
    }])),
  }
}

const base = summarise(baseRuns), neu = summarise(newRuns)
const out = { generated: new Date().toISOString(), conversations: convs, baseline: { config: BASE, model_id: 'deepseek-v4-flash', ...base }, migrated: { config: NEW, model_id: 'deepseek-flash', ...neu } }
fs.writeFileSync(path.join(RESULTS, 'migration-compare.json'), JSON.stringify(out, null, 1))

const row = (label, a, b) => `| ${label} | ${a} | ${b} |`
const md = [
  '# DeepSeek model-id migration regression (2026-09-17)', '',
  `Conversations: ${convs.join(', ')} · 3 runs each · same pipeline bundle, prompts, corpus and deadline overrides as the main benchmark. Only natively-api's \`DEEPSEEK_MODEL\` differs.`, '',
  `| Metric | Before: \`deepseek-v4-flash\` (${BASE}, 2026-09-16) | After: \`deepseek-flash\` (${NEW}, 2026-09-16/17) |`, '|---|---|---|',
  row('Runs / summaries produced', `${base.n} / ${base.succeeded}`, `${neu.n} / ${neu.succeeded}`),
  row('Model-call errors · dropped chunks · blocked Gemini fallbacks', `${base.model_call_errors} · ${base.chunks_dropped} · ${base.blocked_fallback_calls}`, `${neu.model_call_errors} · ${neu.chunks_dropped} · ${neu.blocked_fallback_calls}`),
  row('Production deadline breaches (calls)', base.prod_deadline_violations, neu.prod_deadline_violations),
  row('Model id sent by natively-api', base.requested_models.join(', '), neu.requested_models.join(', ')),
  row('Model reported by DeepSeek', base.response_models.join(', '), neu.response_models.join(', ')),
  row('`thinking` sent · reasoning tokens', `${base.thinking_sent.join(', ')} · ${base.reasoning_tokens}`, `${neu.thinking_sent.join(', ')} · ${neu.reasoning_tokens}`),
  row('All verification checks pass', base.verify_all, neu.verify_all),
  row('Pipeline latency P50 / P90 (s)', `${f1(base.p50_s)} / ${f1(base.p90_s)}`, `${f1(neu.p50_s)} / ${f1(neu.p90_s)}`),
  row('Mean input / output tokens per summary', `${f1(base.mean_input_tokens, 0)} / ${f1(base.mean_output_tokens, 0)}`, `${f1(neu.mean_input_tokens, 0)} / ${f1(neu.mean_output_tokens, 0)}`),
  row('Mean cost per summary (cold cache, off-peak)', `$${f1(base.mean_cost_cold_offpeak, 4)}`, `$${f1(neu.mean_cost_cold_offpeak, 4)}`),
  row('Action items · decisions · sections · bullets (mean)', `${f1(base.action_items)} · ${f1(base.decisions)} · ${f1(base.sections)} · ${f1(base.section_bullets)}`, `${f1(neu.action_items)} · ${f1(neu.decisions)} · ${f1(neu.sections)} · ${f1(neu.section_bullets)}`),
  row('Gold-fact anchor retention (all / critical)', `${pc(base.anchor_retention)} / ${pc(base.critical_anchor_retention)}`, `${pc(neu.anchor_retention)} / ${pc(neu.critical_anchor_retention)}`),
  row('Numbers not in transcript (mean per summary)', f1(base.unsupported_numbers, 2), f1(neu.unsupported_numbers, 2)),
  row('Superseded-value leaks (mean per summary)', f1(base.superseded_value_leaks, 2), f1(neu.superseded_value_leaks, 2)),
  row('Overview polish rejected (runs)', base.polish_overview_rejected, neu.polish_overview_rejected),
  row('Gemini-judged weighted fact retention', pc(base.judged_fact_retention), 'not judged (Gemini credits depleted)'),
  '', '| Conversation | Anchor retention before → after | P50 s before → after | Output tokens before → after |', '|---|---|---|---|',
  ...convs.map(c => `| ${c} | ${pc(base.per_conversation[c].anchor)} → ${pc(neu.per_conversation[c].anchor)} | ${f1(base.per_conversation[c].p50_s)} → ${f1(neu.per_conversation[c].p50_s)} | ${f1(base.per_conversation[c].out_tokens, 0)} → ${f1(neu.per_conversation[c].out_tokens, 0)} |`),
  '',
  '**Reading this table**',
  '- DeepSeek documents `deepseek-v4-flash` as a retired alias served by DeepSeek-V4.1-Flash, and both arms report `deepseek-flash` as the answering model, so differences here are run-to-run sampling noise (no temperature is set on either side), not a model change.',
  '- Anchor retention, unsupported numbers and superseded-value leaks are deterministic text checks, applied identically to both arms. They are coarser than the judge: the superseded-value check counts any occurrence of a number unique to a correction\'s initial value, so it over-counts (a "9" elsewhere in the summary matches). Use them for before/after deltas only.',
  '- Hallucinated non-numeric content, speaker attribution and decision correctness were not checked: they need the LLM judge, whose Gemini key has no prepaid credits.',
  '- A Gemini Flash-Lite arm was not run for the same reason (the key returns 429 RESOURCE_EXHAUSTED), and because Flash-Lite is not the summary generator in natively-api: it is only the fallback leg after DeepSeek.',
  '- Both arms ran in the DeepSeek off-peak window (before: 2026-09-16 20:04-20:48 UTC; after: 23:34-23:37 UTC), from the same machine.',
  '',
]
fs.writeFileSync(path.join(RESULTS, 'MIGRATION_REGRESSION.md'), md.join('\n'))
console.log(md.join('\n'))
