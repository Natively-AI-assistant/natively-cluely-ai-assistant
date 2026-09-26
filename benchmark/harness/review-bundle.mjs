// Blind human-review bundle: for every conversation, the lowest-numbered VALID run of every configuration (fixed rule,
// no cherry-picking) under shuffled letters, plus the facts on which the blinded summaries
// disagree most (per the judge's fact checks). The letter key lives in a separate file.
import fs from 'node:fs'
import path from 'node:path'
import { renderSummary } from './render.mjs'

const BENCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const config = JSON.parse(fs.readFileSync(path.join(BENCH, 'config.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'manifest.json'), 'utf8'))
const OUT = path.join(BENCH, 'reports/human-review')
// Use the lowest-numbered run that is in the analysed set (infra-failed runs excluded).
const SELECTED = fs.readFileSync(path.join(BENCH, 'results/runs-selected.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const pickRun = (cfg, conv) => SELECTED.filter(r => r.config_id === cfg && r.conversation_id === conv).map(r => r.run).sort()[0] || null
fs.mkdirSync(OUT, { recursive: true })
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const rnd = seeded(917)
const LETTERS = 'ABCDEF'
const key = {}
const index = ['# Human review bundle (blind)', '', 'Each file shows the SAME conversation summarized by six configurations under shuffled letters (lowest-numbered valid run of each, fixed rule; credit-exhausted infra failures excluded). The letter key is in `../review-key.json` — open it only after reviewing.', '', '| Conversation | Type | Length | File |', '|---|---|---|---|']
const SYM = { present: '✔', partial: '◐', missing: '✘', contradicted: '⚠' }

for (const conv of manifest.conversations) {
  const cfgs = config.configs.map(c => c.id)
  for (let i = cfgs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cfgs[i], cfgs[j]] = [cfgs[j], cfgs[i]] }
  key[conv.id] = Object.fromEntries(cfgs.map((c, i) => [LETTERS[i], { config: c, run: pickRun(c, conv.id) }]))
  const ref = JSON.parse(fs.readFileSync(path.join(BENCH, 'references', `${conv.id}.json`), 'utf8'))
  const lines = [`# ${conv.id} — ${conv.category}, ${conv.length_bucket} (${conv.duration_min} min, ${conv.words} words)`, '',
    `**Source transcript:** \`benchmark/transcripts/src/${conv.id}.txt\`${conv.source_url ? ` (from ${conv.source_url})` : ''}  `,
    `**Reference fact sheet:** \`benchmark/references/${conv.id}.json\`  `, `**Context:** ${ref.context || ''}`, '',
    `## What a good summary must include`, ...(ref.summary_must_include || []).map(x => `- ${x}`), '']
  const evals = {}
  for (const [L, { config: cfg }] of Object.entries(key[conv.id])) {
    const rl = pickRun(cfg, conv.id); const ep = rl ? path.join(BENCH, 'evaluations', cfg, conv.id, `${rl}.json`) : ''
    if (ep && fs.existsSync(ep)) evals[L] = JSON.parse(fs.readFileSync(ep, 'utf8')).evaluation
  }
  // Disagreement table: facts (critical/important) where the letters' statuses differ.
  const factRows = []
  for (const f of ref.facts.filter(f => f.importance !== 'minor')) {
    const st = Object.fromEntries(Object.entries(evals).map(([L, e]) => [L, (e.fact_checks || []).find(x => x.id === f.id)?.status || '?']))
    const good = Object.values(st).filter(s => s === 'present').length
    const bad = Object.values(st).filter(s => s === 'missing' || s === 'contradicted').length
    if (good > 0 && bad > 0) factRows.push({ f, st, spread: Math.min(good, bad) + (Object.values(st).includes('contradicted') ? 1 : 0) })
  }
  factRows.sort((a, b) => b.spread - a.spread || (a.f.importance === 'critical' ? -1 : 1))
  lines.push('## Most important disagreements (judge fact checks)', '', `✔ present · ◐ partial · ✘ missing · ⚠ contradicted`, '', `| Fact | Imp. | ${Object.keys(key[conv.id]).join(' | ')} |`, `|---|---|${Object.keys(key[conv.id]).map(() => '---').join('|')}|`)
  for (const row of factRows.slice(0, 15)) lines.push(`| ${row.f.id}: ${row.f.statement.replace(/\|/g, '/')} | ${row.f.importance} | ${Object.keys(key[conv.id]).map(L => SYM[row.st[L]] || '?').join(' | ')} |`)
  if (!factRows.length) lines.push('| (no disagreements on critical/important facts) | | |')
  lines.push('', '## Judge-flagged problems', '')
  for (const L of Object.keys(key[conv.id])) {
    const e = evals[L]
    if (!e) { lines.push(`**${L}:** (not judged)`); continue }
    const items = [...(e.critical_errors || []).map(x => `critical: ${x}`), ...(e.hallucinated_information || []).map(x => `hallucination: ${x}`), ...(e.superseded_values_reported || []).map(x => `superseded value: ${x.correction_id} → ${x.reported}`), ...(e.not_decisions_reported_as_decided || []).map(x => `suggestion reported as decision: ${x}`)]
    lines.push(`**${L}** — overall ${e.overall_summary_quality}/10, accuracy ${e.factual_accuracy}, retention ${e.important_information_retention}, conciseness ${e.conciseness}`)
    lines.push(...(items.length ? items.map(x => `- ${x}`) : ['- none flagged']), '')
  }
  for (const [L, { config: cfg }] of Object.entries(key[conv.id])) {
    const rl = pickRun(cfg, conv.id)
    const op = rl ? path.join(BENCH, 'outputs', cfg, conv.id, `${rl}.json`) : ''
    const s = op && fs.existsSync(op) ? JSON.parse(fs.readFileSync(op, 'utf8')).summary : null
    lines.push('', '---', '', `# Summary ${L}`, '', `_(${rl || 'no valid run'})_`, '', renderSummary(s).replace(/^# /m, '### Title: ').replace(/^## /gm, '#### '))
  }
  const file = `${conv.id}.md`
  fs.writeFileSync(path.join(OUT, file), lines.join('\n') + '\n')
  index.push(`| ${conv.id} | ${conv.category} | ${conv.length_bucket} | [${file}](human-review/${file}) |`)
}
fs.writeFileSync(path.join(BENCH, 'reports/review-key.json'), JSON.stringify(key, null, 1))
fs.writeFileSync(path.join(BENCH, 'reports/HUMAN_REVIEW_INDEX.md'), index.join('\n') + '\n')
console.log('review bundle written')
