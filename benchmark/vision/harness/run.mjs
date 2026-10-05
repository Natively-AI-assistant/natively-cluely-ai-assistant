// Adaptive vision benchmark: deepseek-flash vs gemini-3.8-flash.
//
// Starts at the HARDEST level and walks DOWN one level at a time while DeepSeek
// is below the pass bar, stopping at the first level it clears — that level is
// its ceiling. Gemini runs the same tasks at every level visited, so each level
// is a like-for-like comparison.
//
// Both providers are called with Natively's PRODUCTION request shape:
//   - images normalized by lib/imageNormalizer.js (what /v1/chat does), identical bytes to both;
//   - DeepSeek: buildDeepSeekBody(..., { images }) → thinking disabled;
//   - Gemini: v1beta generateContent, system_instruction, inlineData parts,
//     thinkingConfigForModel('gemini-3.8-flash') → thinkingLevel 'low'.
//
// Usage: node run.mjs [--runs 2] [--shots ../shots] [--out ../results]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVELS } from './tasks.mjs'
import { checkOne } from './scoring.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const API = path.join(ROOT, 'natively-api')
const { buildDeepSeekBody, DEEPSEEK_CHAT_URL } = await import(path.join(API, 'lib/deepseekProvider.js'))
const { thinkingConfigForModel, GEMINI_FLASH_MODEL } = await import(path.join(API, 'lib/flashModelPicker.js'))
const { normalizeImages } = await import(path.join(API, 'lib/imageNormalizer.js'))

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d }
const RUNS = Number(arg('--runs', 2))
const SHOTS = path.resolve(arg('--shots', path.join(HERE, '../shots')))
const OUT = path.resolve(arg('--out', path.join(HERE, '../results')))
const PASS_BAR = Number(arg('--pass-bar', 0.8))
// The ladder runs hardest-first and descends. --early-stop halts at the first
// level DeepSeek clears; by default every level runs, because a model can clear
// a hard level and still trip on an easier one (UI-state judgement did exactly that).
const EARLY_STOP = process.argv.includes('--early-stop')
fs.mkdirSync(OUT, { recursive: true })

const readEnv = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const apiEnv = readEnv(path.join(API, '.env'))
const rootEnv = readEnv(path.join(ROOT, '.env'))
const DS_KEY = apiEnv.DEEPSEEK_API_KEY
// natively-api's own Gemini key is out of prepaid credits (429 RESOURCE_EXHAUSTED),
// so the comparison uses the repo-root key. Same model, same request shape.
const GEM_KEY = rootEnv.GEMINI_API_KEY

const SYSTEM = 'You are Natively, a screen-analysis assistant. Answer only from the screenshot, tersely, one numbered line per question. If a value is not legible, say UNKNOWN rather than guessing.'

// Pricing per 1M tokens, for the cost column (DeepSeek off-peak; Gemini list).
const PRICE = { deepseek: { in: 0.15, out: 0.60 }, gemini: { in: 0.30, out: 2.50 } }

const imgCache = new Map()
async function shotImage(id) {
  if (!imgCache.has(id)) {
    const raw = { mime_type: 'image/png', data: fs.readFileSync(path.join(SHOTS, `${id}.png`)).toString('base64') }
    const { images } = await normalizeImages([raw], { maxCount: 4 })
    imgCache.set(id, images[0])
  }
  return imgCache.get(id)
}
const taskImages = (task) => Promise.all((task.shots ?? [task.shot]).map(shotImage))

async function callDeepSeek(q, imgs, { thinking = false } = {}) {
  const body = buildDeepSeekBody('deepseek-flash', [{ role: 'user', content: q }], SYSTEM, { stream: false, images: imgs })
  // --with-thinking probes whether DeepSeek's counting/comparison errors are a
  // reasoning gap rather than a seeing gap. Not Natively's configuration: the
  // shipped path sends thinking disabled.
  if (thinking) { body.thinking = { type: 'enabled' }; body.reasoning_effort = 'low' }
  const t0 = Date.now()
  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS_KEY}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  })
  const j = await res.json().catch(() => ({}))
  const u = j.usage || {}
  return {
    ms: Date.now() - t0, status: res.status, text: j.choices?.[0]?.message?.content || '', model: j.model,
    in_tokens: u.prompt_tokens ?? null, out_tokens: u.completion_tokens ?? null,
    cost: ((u.prompt_tokens || 0) * PRICE.deepseek.in + (u.completion_tokens || 0) * PRICE.deepseek.out) / 1e6,
    error: j.error?.message,
  }
}

async function callGemini(q, imgs) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: q }, ...imgs.map((i) => ({ inlineData: { mimeType: i.mime_type, data: i.data } }))] }],
    system_instruction: { parts: [{ text: SYSTEM }] },
  }
  Object.assign(body, thinkingConfigForModel(GEMINI_FLASH_MODEL))
  const t0 = Date.now()
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEM_KEY },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  })
  const j = await res.json().catch(() => ({}))
  const um = j.usageMetadata || {}
  const out = (um.totalTokenCount ?? 0) - (um.promptTokenCount ?? 0)
  return {
    ms: Date.now() - t0, status: res.status, model: GEMINI_FLASH_MODEL,
    text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n'),
    in_tokens: um.promptTokenCount ?? null, out_tokens: out,
    thinking_tokens: um.thoughtsTokenCount ?? 0,
    cost: ((um.promptTokenCount || 0) * PRICE.gemini.in + Math.max(0, out) * PRICE.gemini.out) / 1e6,
    error: j.error?.message,
  }
}

const PROVIDERS = { deepseek: callDeepSeek, gemini: callGemini }
if (process.argv.includes('--with-thinking')) PROVIDERS.deepseek_thinking = (q, imgs) => callDeepSeek(q, imgs, { thinking: true })

const results = []
const levelSummary = []
let ceiling = null

for (const level of LEVELS) {
  const perProvider = {}
  for (const [prov, call] of Object.entries(PROVIDERS)) {
    const rows = []
    for (const task of level.tasks) {
      const imgs = await taskImages(task)
      for (let run = 1; run <= RUNS; run++) {
        let r
        try { r = await call(task.q, imgs) } catch (e) { r = { status: 0, text: '', error: e.message, ms: 0 } }
        const checks = Object.fromEntries(Object.entries(task.checks).map(([k, spec]) => [k, checkOne(spec, r.text)]))
        const passed = Object.values(checks).filter(Boolean).length
        const row = { level: level.level, provider: prov, task: task.id, shot: (task.shots ?? [task.shot]).join('+'), run, status: r.status, ms: r.ms, model: r.model, in_tokens: r.in_tokens, out_tokens: r.out_tokens, thinking_tokens: r.thinking_tokens ?? null, cost_usd: r.cost, passed, total: Object.keys(checks).length, checks, answer: r.text, error: r.error }
        rows.push(row); results.push(row)
        console.log(`L${level.level} ${prov.padEnd(8)} ${task.id.padEnd(16)} run${run} ${passed}/${row.total} ${r.ms}ms${r.error ? ' ERR ' + r.error.slice(0, 60) : ''}`)
      }
    }
    const passed = rows.reduce((s, r) => s + r.passed, 0), total = rows.reduce((s, r) => s + r.total, 0)
    const lat = rows.map((r) => r.ms).sort((a, b) => a - b)
    perProvider[prov] = {
      accuracy: total ? passed / total : null, passed, total,
      median_ms: lat[Math.floor(lat.length / 2)],
      cost_per_screenshot: rows.reduce((s, r) => s + (r.cost_usd || 0), 0) / rows.length,
      errors: rows.filter((r) => r.error).length,
    }
  }
  levelSummary.push({ level: level.level, name: level.name, why: level.why, tasks: level.tasks.map((t) => t.id), ...perProvider })
  console.log(`\n== L${level.level} ${level.name}: ` + Object.entries(perProvider).map(([k, v]) => `${k} ${(v.accuracy * 100).toFixed(0)}%`).join(' · ') + '\n')
  if (ceiling === null && perProvider.deepseek.accuracy >= PASS_BAR) ceiling = level.level   // the hardest level DeepSeek clears
  if (EARLY_STOP && ceiling !== null) break
}

const out = {
  generated: new Date().toISOString(),
  config: { runs_per_task: RUNS, pass_bar: PASS_BAR, deepseek: { model: 'deepseek-flash', thinking: 'disabled' }, gemini: { model: 'gemini-3.8-flash', thinkingLevel: 'low' }, images: 'normalizeImages (production), identical bytes to both', shots: SHOTS },
  deepseek_ceiling_level: ceiling,
  levels: levelSummary,
  runs: results,
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(out, null, 1))
console.log('ceiling level for deepseek:', ceiling, '→', path.join(OUT, 'results.json'))
