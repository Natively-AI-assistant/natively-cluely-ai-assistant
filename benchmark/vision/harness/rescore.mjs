// Re-score stored answers with the current checks — no new API calls.
//
// Used after a scoring bug was found on 2026-09-18: a "how many?" check matched
// the model's own "3." answer numbering, crediting two wrong chart answers. The
// fix (line-scoped checks) is applied identically to every stored answer of both
// providers, so old runs stay comparable with new ones.
//
// Usage: node rescore.mjs <results.json> [...more]
import fs from 'node:fs'
import path from 'node:path'
import { LEVELS } from './tasks.mjs'
import { scoreAnswer } from './scoring.mjs'

const TASKS = Object.fromEntries(LEVELS.flatMap((l) => l.tasks.map((t) => [t.id, t])))

for (const file of process.argv.slice(2)) {
  const p = path.resolve(file)
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  const before = {}, after = {}
  for (const run of data.runs) {
    const task = TASKS[run.task]
    if (!task) continue
    before[run.provider] = (before[run.provider] || 0) + run.passed
    const checks = scoreAnswer(task.checks, run.answer || '')
    run.checks = checks
    run.passed = Object.values(checks).filter(Boolean).length
    run.total = Object.keys(checks).length
    after[run.provider] = (after[run.provider] || 0) + run.passed
  }
  for (const level of data.levels) {
    for (const prov of ['deepseek', 'gemini']) {
      const rows = data.runs.filter((r) => r.level === level.level && r.provider === prov)
      const passed = rows.reduce((s, r) => s + r.passed, 0), total = rows.reduce((s, r) => s + r.total, 0)
      level[prov] = { ...level[prov], passed, total, accuracy: total ? passed / total : null }
    }
  }
  data.rescored_at = new Date().toISOString()
  data.rescore_note = 'Checks scoped to the answer line for the question they belong to; applied identically to both providers.'
  const out = p.replace(/\.json$/, '.rescored.json')
  fs.writeFileSync(out, JSON.stringify(data, null, 1))
  console.log(path.basename(p), '→', path.basename(out))
  for (const prov of ['deepseek', 'gemini']) console.log(`  ${prov}: ${before[prov]} → ${after[prov]} checks passed`)
}
