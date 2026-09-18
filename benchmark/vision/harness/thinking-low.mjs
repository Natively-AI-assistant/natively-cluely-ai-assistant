// Is "thinking on, lowest effort" a viable primary configuration?
//
// DeepSeek's Chat Completions effort ladder is low | high | max, with `minimal`
// documented as an alias of `low` — so `low` is the floor with thinking ON, and
// the only step below it is thinking OFF. There is no thinking-token budget.
//
// Three probes:
//   A. minimal vs low — same model behaviour, or a real step down?
//   B. streaming TTFT with thinking on: thinking tokens land BEFORE any visible
//      text, so this is the number the live overlay actually feels.
//   C. do the four tasks DeepSeek fails at thinking-off get fixed at low effort,
//      and at what latency?
//
// Usage: node thinking-low.mjs [--runs 4]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVELS } from './tasks.mjs'
import { scoreAnswer } from './scoring.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const API = path.join(ROOT, 'natively-api')
const { buildDeepSeekBody, DEEPSEEK_CHAT_URL, parseDeepSeekStreamLine } = await import(path.join(API, 'lib/deepseekProvider.js'))
const { normalizeImages } = await import(path.join(API, 'lib/imageNormalizer.js'))

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d }
const RUNS = Number(arg('--runs', 4))
const SHOTS = path.resolve(arg('--shots', path.join(HERE, '../shots')))
const OUT = path.resolve(arg('--out', path.join(HERE, '../results/thinking-low.json')))
const KEY = Object.fromEntries(fs.readFileSync(path.join(API, '.env'), 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })).DEEPSEEK_API_KEY
const SYSTEM = 'You are Natively, a screen-analysis assistant. Answer only from the screenshot, tersely, one numbered line per question. If a value is not legible, say UNKNOWN rather than guessing.'

const cache = new Map()
async function shot(id) {
  if (!cache.has(id)) {
    const raw = { mime_type: 'image/png', data: fs.readFileSync(path.join(SHOTS, `${id}.png`)).toString('base64') }
    cache.set(id, (await normalizeImages([raw], { maxCount: 4 })).images[0])
  }
  return cache.get(id)
}

function withThinking(body, effort) {
  if (effort === 'off') return body
  return { ...body, thinking: { type: 'enabled' }, reasoning_effort: effort }
}

async function call(q, imgs, effort, { stream = false } = {}) {
  const body = withThinking(buildDeepSeekBody('deepseek-flash', [{ role: 'user', content: q }], SYSTEM, { stream, maxTokens: stream ? 8000 : null, images: imgs }), effort)
  const t0 = Date.now()
  const res = await fetch(DEEPSEEK_CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
  if (!stream) {
    const j = await res.json().catch(() => ({}))
    const u = j.usage || {}
    return { ms: Date.now() - t0, status: res.status, text: j.choices?.[0]?.message?.content || '', reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, error: j.error?.message }
  }
  let ttft = null, ttf_reasoning = null, chars = 0, buf = ''
  const headers_ms = Date.now() - t0
  const dec = new TextDecoder()
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      const raw = line.trim()
      if (raw.startsWith('data:') && /reasoning_content"\s*:\s*"/.test(raw) && ttf_reasoning === null) ttf_reasoning = Date.now() - t0
      const ev = parseDeepSeekStreamLine(raw)
      if (ev.type === 'delta' && ev.text) { if (ttft === null) ttft = Date.now() - t0; chars += ev.text.length }
    }
  }
  return { status: res.status, headers_ms, ttft_ms: ttft, ttf_reasoning_ms: ttf_reasoning, total_ms: Date.now() - t0, chars }
}

const out = { generated: new Date().toISOString(), runs: RUNS, A_minimal_vs_low: [], B_streaming_ttft: [], C_weak_tasks: [] }
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((m, n) => m - n); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null }

// ── A. minimal vs low ────────────────────────────────────────────────────────
const img = await shot('chart_nolabels')
const Q = 'How many bars are above 100? Answer with the number only.'
for (const effort of ['minimal', 'low', 'high']) {
  for (let i = 0; i < 2; i++) {
    const r = await call(Q, [img], effort)
    out.A_minimal_vs_low.push({ effort, ...r })
    console.log(`A ${effort.padEnd(7)} run${i + 1}: ${r.ms}ms reasoning_tokens=${r.reasoning_tokens} → ${JSON.stringify((r.text || '').slice(0, 40))}`)
  }
}

// ── B. streaming TTFT, thinking off vs low ──────────────────────────────────
for (const effort of ['off', 'low']) {
  for (const id of ['code_bug', 'github_code_small']) {
    const im = await shot(id)
    for (let i = 0; i < RUNS; i++) {
      const r = await call('Explain what this screen shows and what the user should do next.', [im], effort, { stream: true })
      out.B_streaming_ttft.push({ effort, shot: id, run: i + 1, ...r })
      console.log(`B ${effort.padEnd(4)} ${id.padEnd(18)} run${i + 1}: ttft ${String(r.ttft_ms).padStart(6)}ms  (first reasoning chunk ${String(r.ttf_reasoning_ms ?? '-').padStart(5)}ms)  total ${r.total_ms}ms`)
    }
  }
}

// ── C. the four weak tasks at low effort ────────────────────────────────────
const WEAK = ['tiny_code', 'chart_read', 'glyph_counting', 'dashboard_state']
const TASKS = Object.fromEntries(LEVELS.flatMap((l) => l.tasks.map((t) => [t.id, t])))
for (const id of WEAK) {
  const task = TASKS[id]
  const imgs = await Promise.all((task.shots ?? [task.shot]).map(shot))
  for (const effort of ['off', 'low']) {
    for (let i = 0; i < RUNS; i++) {
      const r = await call(task.q, imgs, effort)
      const checks = scoreAnswer(task.checks, r.text || '')
      const passed = Object.values(checks).filter(Boolean).length
      out.C_weak_tasks.push({ task: id, effort, run: i + 1, ms: r.ms, reasoning_tokens: r.reasoning_tokens, passed, total: Object.keys(checks).length, checks, answer: r.text })
      console.log(`C ${id.padEnd(16)} ${effort.padEnd(4)} run${i + 1}: ${passed}/${Object.keys(checks).length} ${r.ms}ms think=${r.reasoning_tokens}`)
    }
  }
}

out.summary = {
  A: Object.fromEntries(['minimal', 'low', 'high'].map((e) => {
    const x = out.A_minimal_vs_low.filter((r) => r.effort === e)
    return [e, { median_ms: pct(x.map((r) => r.ms), 0.5), median_reasoning_tokens: pct(x.map((r) => r.reasoning_tokens), 0.5) }]
  })),
  B: Object.fromEntries(['off', 'low'].map((e) => {
    const x = out.B_streaming_ttft.filter((r) => r.effort === e)
    return [e, { ttft_p50: pct(x.map((r) => r.ttft_ms), 0.5), ttft_p90: pct(x.map((r) => r.ttft_ms), 0.9), ttft_max: pct(x.map((r) => r.ttft_ms), 1), total_p50: pct(x.map((r) => r.total_ms), 0.5) }]
  })),
  C: Object.fromEntries(WEAK.flatMap((t) => ['off', 'low'].map((e) => {
    const x = out.C_weak_tasks.filter((r) => r.task === t && r.effort === e)
    return [`${t}/${e}`, { passed: x.reduce((s, r) => s + r.passed, 0), total: x.reduce((s, r) => s + r.total, 0), clean: x.filter((r) => r.passed === r.total).length + '/' + x.length, median_ms: pct(x.map((r) => r.ms), 0.5), max_ms: pct(x.map((r) => r.ms), 1) }]
  }))),
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log('\n' + JSON.stringify(out.summary, null, 1))
