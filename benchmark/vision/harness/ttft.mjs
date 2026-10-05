// Time-to-first-token for screenshot answers, streaming, production shapes.
//
// The ladder in run.mjs used non-streaming calls, so it measured total latency
// only. The live overlay streams, and what a user feels is the wait for the
// FIRST VISIBLE CHARACTER — for Gemini that means text, not thinking tokens.
//
// DeepSeek: callDeepSeekStream's body (stream + stream_options + 8k output cap).
// Gemini:   streamGenerateContent?alt=sse, thinkingLevel low, same 8k cap.
//
// Usage: node ttft.mjs [--runs 4] [--shots ../shots] [--out ../results/ttft.json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const API = path.join(ROOT, 'natively-api')
const { buildDeepSeekBody, DEEPSEEK_CHAT_URL, parseDeepSeekStreamLine } = await import(path.join(API, 'lib/deepseekProvider.js'))
const { thinkingConfigForModel, GEMINI_FLASH_MODEL } = await import(path.join(API, 'lib/flashModelPicker.js'))
const { normalizeImages } = await import(path.join(API, 'lib/imageNormalizer.js'))

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d }
const RUNS = Number(arg('--runs', 4))
const SHOTS = path.resolve(arg('--shots', path.join(HERE, '../shots')))
const OUT = path.resolve(arg('--out', path.join(HERE, '../results/ttft.json')))
const AI_STREAM_MAX_OUTPUT_TOKENS = 8000    // server.js default

const readEnv = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const DS_KEY = readEnv(path.join(API, '.env')).DEEPSEEK_API_KEY
const GEM_KEY = readEnv(path.join(ROOT, '.env')).GEMINI_API_KEY

const SYSTEM = 'You are Natively, a screen-analysis assistant. Answer from the screenshot.'
// Two shapes of question: the short lookup a user fires mid-call, and the long
// explanation where streaming matters most.
const PROMPTS = {
  short: 'What is on this screen? One sentence.',
  long: 'Explain what this screen shows and what the user should do next. Be thorough.',
}

async function shot(id) {
  const raw = { mime_type: 'image/png', data: fs.readFileSync(path.join(SHOTS, `${id}.png`)).toString('base64') }
  const { images } = await normalizeImages([raw], { maxCount: 4 })
  return images[0]
}

async function streamDeepSeek(q, img) {
  const body = buildDeepSeekBody('deepseek-flash', [{ role: 'user', content: q }], SYSTEM, { stream: true, maxTokens: AI_STREAM_MAX_OUTPUT_TOKENS, images: [img] })
  const t0 = Date.now()
  const res = await fetch(DEEPSEEK_CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
  const headers_ms = Date.now() - t0
  let ttft = null, chars = 0, buf = ''
  const dec = new TextDecoder()
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      const ev = parseDeepSeekStreamLine(line.trim())
      if (ev.type === 'delta' && ev.text) { if (ttft === null) ttft = Date.now() - t0; chars += ev.text.length }
    }
  }
  return { status: res.status, headers_ms, ttft_ms: ttft, total_ms: Date.now() - t0, chars }
}

async function streamGemini(q, img) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: q }, { inlineData: { mimeType: img.mime_type, data: img.data } }] }],
    system_instruction: { parts: [{ text: SYSTEM }] },
  }
  Object.assign(body, thinkingConfigForModel(GEMINI_FLASH_MODEL))
  body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: AI_STREAM_MAX_OUTPUT_TOKENS }
  const t0 = Date.now()
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEM_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  })
  const headers_ms = Date.now() - t0
  let ttft = null, firstChunk = null, chars = 0, thinking = 0, buf = ''
  const dec = new TextDecoder()
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let j; try { j = JSON.parse(line.slice(6)) } catch { continue }
      if (firstChunk === null) firstChunk = Date.now() - t0
      thinking = j.usageMetadata?.thoughtsTokenCount ?? thinking
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) { if (ttft === null) ttft = Date.now() - t0; chars += text.length }
    }
  }
  return { status: res.status, headers_ms, first_chunk_ms: firstChunk, ttft_ms: ttft, total_ms: Date.now() - t0, chars, thinking_tokens: thinking }
}

const SHOT_IDS = ['code_bug', 'github_code_small', 'stock_financials']
const rows = []
for (const id of SHOT_IDS) {
  const img = await shot(id)
  for (const [shape, q] of Object.entries(PROMPTS)) {
    for (let run = 1; run <= RUNS; run++) {
      for (const [prov, fn] of [['deepseek', streamDeepSeek], ['gemini', streamGemini]]) {
        let r; try { r = await fn(q, img) } catch (e) { r = { error: e.message } }
        rows.push({ provider: prov, shot: id, shape, run, ...r })
        console.log(`${prov.padEnd(8)} ${id.padEnd(18)} ${shape.padEnd(5)} run${run} ttft ${String(r.ttft_ms ?? '-').padStart(5)}ms  headers ${String(r.headers_ms ?? '-').padStart(5)}ms  total ${String(r.total_ms ?? '-').padStart(5)}ms  ${r.chars ?? 0} chars${r.thinking_tokens ? ` (thinking ${r.thinking_tokens} tok)` : ''}${r.error ? ' ERR ' + r.error : ''}`)
      }
    }
  }
}

const pct = (a, p) => { const s = a.filter((x) => x != null).sort((m, n) => m - n); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null }
const summary = {}
for (const prov of ['deepseek', 'gemini']) {
  const x = rows.filter((r) => r.provider === prov && !r.error)
  summary[prov] = {
    calls: x.length,
    ttft_p50: pct(x.map((r) => r.ttft_ms), 0.5), ttft_p90: pct(x.map((r) => r.ttft_ms), 0.9),
    ttft_min: pct(x.map((r) => r.ttft_ms), 0), ttft_max: pct(x.map((r) => r.ttft_ms), 0.999),
    headers_p50: pct(x.map((r) => r.headers_ms), 0.5),
    total_p50: pct(x.map((r) => r.total_ms), 0.5),
    chars_p50: pct(x.map((r) => r.chars), 0.5),
    by_shape: Object.fromEntries(['short', 'long'].map((s) => [s, pct(x.filter((r) => r.shape === s).map((r) => r.ttft_ms), 0.5)])),
  }
}
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), runs_per_cell: RUNS, shots: SHOT_IDS, summary, rows }, null, 1))
console.log('\n', JSON.stringify(summary, null, 1))
