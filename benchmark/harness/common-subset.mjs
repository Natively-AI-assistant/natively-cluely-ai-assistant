// Recomputes headline metrics on the conversation set where ALL six configs have >=1 judged run,
// so luna-max's partial coverage (OpenAI credit exhaustion) cannot bias the comparison.
import fs from 'node:fs'
import path from 'node:path'
const BENCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const sel = fs.readFileSync(path.join(BENCH, 'results/runs-selected.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const ids = ['ds-flash-prod', 'ds-flash-thinking', 'luna-max', 'luna-medium', 'luna-low', 'luna-none']
const convs = [...new Set(sel.map(r => r.conversation_id))].filter(c => ids.every(id => sel.some(r => r.config_id === id && r.conversation_id === c && r.judged)))
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const convMean = (rows, k) => mean(convs.map(c => mean(rows.filter(r => r.conversation_id === c && typeof r[k] === 'number').map(r => r[k]))).filter(x => x != null))
const out = { conversations: convs, by_config: {} }
for (const id of ids) {
  const rows = sel.filter(r => r.config_id === id && convs.includes(r.conversation_id))
  const j = rows.filter(r => r.judged)
  out.by_config[id] = {
    runs: rows.length, judged: j.length,
    fact_retention_weighted: convMean(j, 'fact_retention_weighted'),
    fact_retention_critical: convMean(j, 'fact_retention_critical'),
    q_overall_summary_quality: convMean(j, 'q_overall_summary_quality'),
    facts_contradicted: convMean(j, 'facts_contradicted'),
    pipeline_ms_p50: med(rows.map(r => r.pipeline_ms)),
    cost_cold_offpeak_usd: convMean(rows, 'cost_cold_offpeak_usd'),
    cost_cold_peak_usd: convMean(rows, 'cost_cold_peak_usd'),
  }
}
const base = out.by_config['ds-flash-prod']
for (const id of ids) {
  const c = out.by_config[id]
  // paired per-conversation difference vs ds-flash-prod
  const diffs = convs.map(cv => {
    const m = cfg => mean(sel.filter(r => r.config_id === cfg && r.conversation_id === cv && r.judged).map(r => r.fact_retention_weighted))
    return m(id) - m('ds-flash-prod')
  })
  c.paired_diff_fact_retention_vs_ds_prod = id === 'ds-flash-prod' ? null : mean(diffs)
  c.conversations_where_worse_than_ds_prod = id === 'ds-flash-prod' ? null : diffs.filter(d => d < 0).length
}
fs.writeFileSync(path.join(BENCH, 'results/common-subset.json'), JSON.stringify(out, null, 1))
console.log('common conversations:', convs.join(', '))
for (const id of ids) { const c = out.by_config[id]; console.log(id.padEnd(18), `runs=${c.runs} judged=${c.judged} factW=${(c.fact_retention_weighted * 100).toFixed(1)}% crit=${(c.fact_retention_critical * 100).toFixed(1)}% overall=${c.q_overall_summary_quality.toFixed(2)} contra=${c.facts_contradicted.toFixed(2)} p50=${(c.pipeline_ms_p50 / 1000).toFixed(0)}s diff=${c.paired_diff_fact_retention_vs_ds_prod == null ? '-' : (c.paired_diff_fact_retention_vs_ds_prod * 100).toFixed(1) + 'pp'} worseIn=${c.conversations_where_worse_than_ds_prod ?? '-'}/${out.conversations.length}`) }
