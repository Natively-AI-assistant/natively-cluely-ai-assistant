// benchmark/harness/provider-shim.mjs
//
// Preloaded into an UNMODIFIED natively-api process with `node --import`.
// It changes nothing in natively-api's code. It sits at the transport boundary:
//
//   natively-api routeChat -> callDeepSeek -> buildDeepSeekBody (production body)
//        -> fetch('https://api.deepseek.com/chat/completions')   <- intercepted here
//
// and, per BENCH_CONFIG_ID, translates ONLY provider/model/reasoning before
// forwarding to the real provider, then hands natively-api back a response in
// the shape callDeepSeek already parses. Everything upstream of the fetch
// (prompt assembly, message clamping, language injection, routing, parsing,
// validation, repair) is the real code path.
//
// Also: blocks and records every OTHER AI-provider call (Gemini, MiniMax, Groq,
// OpenRouter...) so a silent production fallback can never produce a summary,
// and records per-call wire metadata (never Authorization headers, never
// message text, never reasoning content) to BENCH_WIRE_LOG.

import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const API_DIR = process.env.BENCH_API_DIR
const undici = require(`${API_DIR}/node_modules/undici`)
const dotenv = require(`${API_DIR}/node_modules/dotenv`)

const CONFIG_ID = process.env.BENCH_CONFIG_ID
const CONFIGS = JSON.parse(fs.readFileSync(process.env.BENCH_CONFIG_FILE, 'utf8')).configs
const CFG = CONFIGS.find(c => c.id === CONFIG_ID)
if (!CFG) throw new Error(`[bench-shim] unknown BENCH_CONFIG_ID ${CONFIG_ID}`)
const WIRE_LOG = process.env.BENCH_WIRE_LOG

// Keys: DeepSeek from natively-api/.env (what the server uses); OpenAI from the
// repo-root .env (natively-api has no OpenAI key). Read, never printed.
const rootEnv = dotenv.parse(fs.readFileSync(process.env.BENCH_ROOT_ENV))
const apiEnv = dotenv.parse(fs.readFileSync(`${API_DIR}/.env`))
const KEYS = { deepseek: apiEnv.DEEPSEEK_API_KEY, openai: rootEnv.OPENAI_API_KEY }

// Long-timeout agent for the forwarded call so a slow configuration is measured
// rather than cut off by the harness. Production's own 30s headersTimeout
// (server.js setGlobalDispatcher) is recorded as a compliance flag instead.
const upstreamAgent = new undici.Agent({ headersTimeout: 1_800_000, bodyTimeout: 1_800_000, connections: 64, keepAliveTimeout: 30_000 })

const als = new AsyncLocalStorage()
const origEmit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req, res) {
  if (event === 'request' && req && req.headers) {
    const reqId = String(req.headers['x-request-id'] || '')
    return als.run({ reqId }, () => origEmit.call(this, event, req, res))
  }
  return origEmit.apply(this, arguments)
}

const AI_HOSTS = [
  'generativelanguage.googleapis.com', 'aiplatform.googleapis.com', 'api.minimax', 'minimax',
  'api.groq.com', 'openrouter.ai', 'api.openai.com', 'api.anthropic.com', 'bedrock', 'api.mistral.ai',
]
const BLOCK_HOSTS = ['api.telegram.org', 'posthog', 'axiom.co', 'sentry.io', 'api.resend.com']

function writeWire(rec) {
  fs.appendFileSync(WIRE_LOG, JSON.stringify(rec) + '\n')
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16)
const nowIso = () => new Date().toISOString()

const origFetch = globalThis.fetch
let seq = 0

globalThis.fetch = async function benchFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : (input?.url || String(input))
  const ctx = als.getStore() || {}
  if (url.startsWith('https://api.deepseek.com/chat/completions')) {
    return handleModelCall(url, init, ctx)
  }
  let host = ''
  try { host = new URL(url).host } catch { }
  if (AI_HOSTS.some(h => host.includes(h))) {
    writeWire({ kind: 'BLOCKED_FALLBACK', config_id: CONFIG_ID, req_id: ctx.reqId || null, host, ts: nowIso() })
    return new Response(JSON.stringify({ error: { message: 'bench: fallback provider blocked' } }), { status: 503, headers: { 'content-type': 'application/json' } })
  }
  if (BLOCK_HOSTS.some(h => host.includes(h))) {
    writeWire({ kind: 'BLOCKED_SIDE_EFFECT', config_id: CONFIG_ID, req_id: ctx.reqId || null, host, ts: nowIso() })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return origFetch(input, init)
}

function summarizeMessages(messages) {
  return (messages || []).map(m => ({ role: m.role, chars: String(m.content ?? '').length, sha: sha(m.content ?? '') }))
}

async function handleModelCall(url, init, ctx) {
  const callSeq = ++seq
  const tStart = performance.now()
  const prodBody = JSON.parse(init.body)
  const { messages, ...prodParams } = prodBody
  const rec = {
    kind: 'MODEL_CALL', config_id: CONFIG_ID, seq: callSeq, req_id: ctx.reqId || null, ts_start: nowIso(),
    production_request_params: prodParams, messages: summarizeMessages(messages),
  }

  let upstreamUrl, upstreamBody, key
  if (CFG.provider === 'deepseek') {
    upstreamUrl = 'https://api.deepseek.com/chat/completions'
    upstreamBody = { ...prodBody, model: CFG.model }
    if (CFG.thinking === 'production') {
      // unchanged: whatever buildDeepSeekBody produced (thinking:{type:'disabled'})
    } else if (CFG.thinking === 'api_default') {
      delete upstreamBody.thinking   // API default = enabled
    }
    key = KEYS.deepseek
  } else if (CFG.provider === 'openai') {
    // Responses API: the only OpenAI surface that accepts reasoning.effort='max'
    // for gpt-5.6-luna (Chat Completions 400s on 'max'). Same surface for all
    // four efforts so the Luna configs differ ONLY in effort.
    upstreamUrl = 'https://api.openai.com/v1/responses'
    upstreamBody = {
      model: CFG.model,
      input: messages.map(m => ({ role: m.role, content: m.content })),
      reasoning: { effort: CFG.reasoning_effort },
      max_output_tokens: Math.min(prodBody.max_tokens ?? 128000, CFG.max_output_tokens_cap),
      store: false,
    }
    key = KEYS.openai
  } else {
    throw new Error(`unknown provider ${CFG.provider}`)
  }
  const { input: _in, messages: _m, ...upstreamParams } = upstreamBody
  rec.upstream_url = upstreamUrl
  rec.upstream_request_params = upstreamParams
  rec.upstream_messages = summarizeMessages(upstreamBody.input || upstreamBody.messages)

  // Infrastructure retry on 429 / 5xx / network only (recorded, never silent).
  const attempts = []
  let res, text, tHeaders, tDone, tSent
  for (let attempt = 0; attempt < 4; attempt++) {
    tSent = performance.now()
    try {
      res = await undici.fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(upstreamBody),
        dispatcher: upstreamAgent,
      })
      tHeaders = performance.now()
      text = await res.text()
      tDone = performance.now()
    } catch (e) {
      attempts.push({ attempt, error: String(e?.cause?.code || e?.message || e).slice(0, 160), ms: Math.round(performance.now() - tSent) })
      if (attempt < 3) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue }
      rec.infra_attempts = attempts
      rec.error = 'network_error'
      rec.total_ms = Math.round(performance.now() - tStart)
      writeWire(rec)
      throw e
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'))
      attempts.push({ attempt, status: res.status, ms: Math.round(tDone - tSent), body: text.slice(0, 200) })
      if (attempt < 3) { await new Promise(r => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * (attempt + 1))); continue }
    }
    break
  }
  rec.infra_retries = attempts.length
  rec.infra_attempts = attempts
  rec.status = res.status
  rec.headers_ms = Math.round(tHeaders - tSent)
  rec.upstream_ms = Math.round(tDone - tSent)            // request sent -> full body received (final attempt)
  rec.total_ms = Math.round(tDone - tStart)               // includes any infra retries/backoff
  rec.ts_end = nowIso()
  const rl = {}
  for (const [k, v] of res.headers) if (k.startsWith('x-ratelimit-remaining') || k === 'openai-processing-ms') rl[k] = v
  rec.rate_limit_headers = rl

  let data
  try { data = JSON.parse(text) } catch { data = null }
  if (res.status !== 200 || !data) {
    rec.error = `http_${res.status}`
    rec.error_body = (text || '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 400)
    writeWire(rec)
    return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } })
  }

  let out
  if (CFG.provider === 'deepseek') {
    const msg = data.choices?.[0]?.message || {}
    rec.response_model = data.model
    rec.finish_reason = data.choices?.[0]?.finish_reason
    rec.usage = data.usage
    rec.reasoning_tokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0
    rec.reasoning_content_chars = typeof msg.reasoning_content === 'string' ? msg.reasoning_content.length : 0
    rec.output_chars = String(msg.content || '').length
    // Strip hidden reasoning before it reaches natively-api (never persisted anywhere).
    if (msg.reasoning_content !== undefined) delete msg.reasoning_content
    out = data
  } else {
    const textOut = (data.output || [])
      .filter(o => o.type === 'message')
      .flatMap(o => (o.content || []).filter(c => c.type === 'output_text').map(c => c.text))
      .join('')
    rec.response_model = data.model
    rec.response_status = data.status
    rec.incomplete_details = data.incomplete_details || null
    rec.echoed_reasoning = data.reasoning ? { effort: data.reasoning.effort } : null
    rec.usage = data.usage
    rec.reasoning_tokens = data.usage?.output_tokens_details?.reasoning_tokens ?? 0
    rec.output_chars = textOut.length
    // Reshape to the chat.completion JSON callDeepSeek/parseDeepSeekResponse read.
    out = {
      id: data.id, object: 'chat.completion', model: data.model,
      choices: [{ index: 0, message: { role: 'assistant', content: textOut }, finish_reason: data.status === 'incomplete' ? 'length' : 'stop' }],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
    }
  }
  writeWire(rec)
  return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
}

console.log(`[bench-shim] active config=${CONFIG_ID} provider=${CFG.provider} model=${CFG.model}`)
