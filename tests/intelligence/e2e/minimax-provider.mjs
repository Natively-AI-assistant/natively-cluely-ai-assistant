/**
 * minimax-provider.mjs — a TEST-ONLY OpenAI-compatible client that drops into the
 * `llmHelper.groqClient` seam so the REAL Natively backend (routing → context →
 * prompt assembly → streamChat/WhatToAnswerLLM) runs unchanged with MiniMax-M2.7
 * as the upstream model. MiniMax serves the OpenAI Chat Completions shape at
 * https://api.minimax.io/v1/chat/completions, so the only thing the seam needs is
 * an object exposing `chat.completions.create(params, {signal})` that returns:
 *   - stream:true  → an async-iterable of { choices:[{ delta:{ content } }] }
 *   - stream:false → { choices:[{ message:{ content } }] }
 *
 * Why a custom adapter (the prompt explicitly allows this): the electron client has
 * NO MiniMax transport — MiniMax lives only in the natively-api gateway. This adapter
 * lives at the transport seam ONLY; it changes nothing about the app's decisions.
 *
 * MiniMax-M2.7 specifics handled here (all verified live 2026-06-14):
 *  - thinking:{type:'disabled'} is IGNORED → the model emits a leading <think>…</think>
 *    block. It is STRIPPED here (incremental for stream, whole-string for non-stream)
 *    so chain-of-thought NEVER reaches the visible answer the backend scores.
 *  - reasoning consumes max_tokens FIRST. With a small cap the answer truncates to
 *    empty. So max_tokens is OVER-BUDGETED (default 8000) — MiniMax bills ACTUAL
 *    tokens, not the reservation, so a generous cap is free.
 *  - first RAW token is reasoning; first VISIBLE token (after </think>) is later.
 *    Both are tracked and surfaced via getTiming() so the runner can report them apart.
 *
 * SECURITY: keys arrive already-masked-for-logging; this module logs only maskedKey.
 */
import { GlobalThrottle } from './minimax-throttle.mjs';

const DEFAULT_BASE_URL = 'https://api.minimax.io';
const CHAT_PATH = '/v1/chat/completions';

// ── status-code → reason (mirrors natively-api/lib/minimaxProvider.js) ───────────
const STATUS = { OK: 0, RATE_LIMIT: 1002, TIMEOUT: 1001, AUTH_FAIL: 1004, INSUFFICIENT_BALANCE: 1008, INTERNAL: 1013, UNKNOWN: 1000, OUTPUT_CONTENT: 1027, TOKEN_LIMIT: 1039, PARAM_ERROR: 2013 };
function statusToReason(code) {
  if (code == null || code === 0) return null;
  switch (code) {
    case STATUS.AUTH_FAIL: return 'auth_error';
    case STATUS.INSUFFICIENT_BALANCE: return 'out_of_credits';
    case STATUS.RATE_LIMIT: case STATUS.TOKEN_LIMIT: return 'rate_limited';
    case STATUS.PARAM_ERROR: case STATUS.OUTPUT_CONTENT: return 'bad_request';
    default: return 'transient';
  }
}
function httpToReason(s) {
  if (s === 401 || s === 403) return 'auth_error';
  if (s === 429) return 'rate_limited';
  if (s === 402) return 'out_of_credits';
  if (s >= 500) return 'transient';
  if (s === 400) return 'bad_request';
  return 'transient';
}

// ── <think> stripping ────────────────────────────────────────────────────────
// MiniMax-M2.7 emits a leading <think>…</think> block EVEN with thinking:disabled,
// and — found at scale in the 7000-run (looking-for-work_0447, a multi-criterion
// gap_analysis_answer) — it ALSO occasionally emits INTERLEAVED <think> blocks
// MID-ANSWER. So we must strip ALL <think>…</think> blocks (leading, interleaved,
// trailing), not just the leading one. CoT must NEVER reach the visible answer.
//
// Whole-string form (non-streaming): remove every <think>…</think> globally; a
// dangling unclosed <think> (truncated reasoning) and everything after it is dropped.
const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;
const THINK_OPEN_ANY_RE = /<think\b[^>]*>/i;
const THINK_CLOSE_RE = /<\/think\s*>/i;
export function stripLeadingThink(text) {
  let s = String(text || '');
  s = s.replace(THINK_BLOCK_RE, '');          // remove all complete blocks anywhere
  const open = s.match(THINK_OPEN_ANY_RE);     // a dangling unclosed <think> → drop it + rest
  if (open) s = s.slice(0, open.index);
  return s.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
}

// Incremental form (streaming): MiniMax SSE splits content into arbitrary deltas, so
// the <think>/</think> tags can land split across deltas. This buffers just enough to
// recognise a tag, discards reasoning inside ANY <think> block (not just a leading
// one), and forwards only real answer text. After a </think> it returns to passing
// through text, and re-enters discard mode on the NEXT <think> — so interleaved CoT
// is stripped too.
const THINK_OPEN_LIT = '<think';
export function makeThinkStripper() {
  let state = 'pass'; // pass (forwarding answer text) | inThink (discarding reasoning)
  let buf = '';
  let emittedNonWs = false; // have we forwarded any non-whitespace yet? (trim leading WS like the whole-string form)
  const trimLeadIfNeeded = (s) => { if (emittedNonWs) return s; const t = s.replace(/^\s+/, ''); if (t) emittedNonWs = true; return t; };
  // longest suffix of x that is a prefix of "<think" (an open tag forming across deltas)
  const partialOpenTail = (x) => {
    for (let n = Math.min(x.length, THINK_OPEN_LIT.length); n > 0; n--) {
      const suf = x.slice(x.length - n).toLowerCase();
      if (THINK_OPEN_LIT.startsWith(suf) || /^<think\b[^>]*$/i.test(x.slice(x.length - n))) return x.slice(x.length - n);
    }
    return '';
  };
  // longest suffix of x that is a prefix of "</think>" (a close tag forming across deltas)
  const partialCloseTail = (x) => {
    const lit = '</think>';
    for (let n = Math.min(x.length, lit.length - 1); n > 0; n--) if (lit.startsWith(x.slice(x.length - n).toLowerCase())) return x.slice(x.length - n);
    return '';
  };
  return {
    push(delta) {
      buf += String(delta || '');
      let out = '';
      while (true) {
        if (state === 'pass') {
          const open = buf.match(THINK_OPEN_ANY_RE);
          if (open) {
            out += trimLeadIfNeeded(buf.slice(0, open.index)); // forward text before the <think>
            buf = buf.slice(open.index + open[0].length);
            state = 'inThink';
            continue;
          }
          // no complete open tag — forward everything except a possible partial open
          // tag forming at the tail (hold it back until we know it's a real <think>).
          const tail = partialOpenTail(buf);
          if (tail) { out += trimLeadIfNeeded(buf.slice(0, buf.length - tail.length)); buf = tail; break; }
          out += trimLeadIfNeeded(buf); buf = ''; break;
        }
        // inThink — discard until </think>
        const close = buf.match(THINK_CLOSE_RE);
        if (close) { buf = buf.slice(close.index + close[0].length).replace(/^\s+/, ''); state = 'pass'; continue; }
        buf = partialCloseTail(buf); break; // drop reasoning, keep a possible partial close tag
      }
      return out;
    },
    flush() {
      if (state === 'pass') { const o = trimLeadIfNeeded(buf); buf = ''; return o; }
      buf = ''; return ''; // inThink leftover = unclosed reasoning, drop
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * createMiniMaxClient(usableKeys, opts) → { chat: { completions: { create } }, ... }
 *  usableKeys: [{ slot, key, maskedKey }] from minimax-keypool.validateKeys().usable
 */
export function createMiniMaxClient(usable, opts = {}) {
  const model = opts.model || 'MiniMax-M2.7';
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const url = baseUrl + CHAT_PATH;
  const maxOutputTokens = opts.maxOutputTokens || 8000; // over-budget so reasoning never starves the answer
  const maxRetries = opts.maxRetries ?? 4;
  const retryBackoffBaseMs = opts.retryBackoffBaseMs ?? 3000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 90000;
  const keyCooldownMs = opts.keyCooldownMs ?? 60000;
  // Max time to wait for a cooled-down key before declaring exhaustion. A rate-limit
  // cooldown (60s) is worth waiting out; an out_of_credits cooldown (6h) is not — give
  // up so the overnight run stops + checkpoints instead of spinning. Default 10min.
  const maxCooldownWaitMs = opts.maxCooldownWaitMs ?? 10 * 60 * 1000;
  const throttle = opts.throttle || new GlobalThrottle({ qpm: opts.qpm || 25 });

  if (!usable.length) throw new Error('createMiniMaxClient: no usable keys');

  // Per-key state: cooldownUntil + usage counters. Raw key only here.
  const keys = usable.map((k) => ({ slot: k.slot, key: k.key, maskedKey: k.maskedKey, cooldownUntil: 0, calls: 0, retries: 0, rateLimited: 0, authErrors: 0, failures: 0, tokensIn: 0, tokensOut: 0, reasoningTokens: 0 }));
  let rr = 0; let invalidated = 0;
  const stats = { calls: 0, retries: 0, rateLimited: 0, authErrors: 0, failures: 0, transient: 0, tokensIn: 0, tokensOut: 0, reasoningTokens: 0 };
  // last-call timing for the runner to read (first raw vs first visible token).
  let lastTiming = { firstRawTokenMs: null, firstVisibleTokenMs: null };

  function nextKey() {
    const now = Date.now();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[(rr + i) % keys.length];
      if (k.cooldownUntil <= now && k.key) { rr = (rr + i + 1) % keys.length; return k; }
    }
    return null; // all cooling down / invalidated
  }

  async function waitForAnyKey() {
    const now = Date.now();
    const soonest = keys.filter((k) => k.key).map((k) => k.cooldownUntil).filter((t) => t > now).sort((a, b) => a - b)[0];
    if (soonest == null) return false; // nothing will free up (all invalidated)
    // If the soonest-available key is more than maxCooldownWaitMs away (e.g. a 6h
    // out_of_credits cooldown), give up gracefully rather than spinning overnight.
    // The caller turns this into an exhaustion error → the row is provider-unavailable
    // → the runner stops + checkpoints, resumable once the key recovers.
    if (soonest - now > maxCooldownWaitMs) return false;
    await sleep(Math.max(250, Math.min(soonest - now, 90000)) + 50);
    return true;
  }

  function buildBody(params, stream) {
    // Pass through the messages the real backend built; pin model + over-budget cap.
    const body = {
      model,
      messages: params.messages,
      temperature: params.temperature != null ? params.temperature : 0.35,
      top_p: params.top_p != null ? params.top_p : 0.9,
      // ALWAYS over-budget: the backend asks for 8192, but M2.7 spends tokens on the
      // (stripped) <think> block FIRST, so a tight cap truncates the visible answer to
      // empty. MiniMax bills actual tokens, not the reservation, so a generous fixed
      // cap is free and guarantees the real answer survives.
      max_tokens: maxOutputTokens,
      stream,
      thinking: { type: 'disabled' }, // requested; M2.7 ignores it → we strip <think> client-side
    };
    if (stream) body.stream_options = { include_usage: true };
    return body;
  }

  function recordUsage(k, usage) {
    if (!usage) return;
    const tin = usage.prompt_tokens || 0;
    const tout = usage.completion_tokens || 0;
    const rt = usage.completion_tokens_details?.reasoning_tokens || 0;
    k.tokensIn += tin; k.tokensOut += tout; k.reasoningTokens += rt;
    stats.tokensIn += tin; stats.tokensOut += tout; stats.reasoningTokens += rt;
  }

  // ── one attempt (returns parsed result or throws a tagged error) ──────────────
  async function attemptNonStream(k, params, signal) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ac.abort(), requestTimeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody(params, false)), signal: ac.signal });
      let data = null; try { data = await res.json(); } catch { /* */ }
      const baseStatus = data?.base_resp?.status_code;
      if (res.status !== 200) { const e = new Error(`http_${res.status}`); e.reason = httpToReason(res.status); e.httpStatus = res.status; throw e; }
      const reason = statusToReason(baseStatus);
      if (reason) { const e = new Error(`base_${baseStatus}`); e.reason = reason; e.baseStatus = baseStatus; throw e; }
      recordUsage(k, data?.usage);
      const raw = data?.choices?.[0]?.message?.content || '';
      const visible = stripLeadingThink(raw);
      lastTiming = { firstRawTokenMs: 0, firstVisibleTokenMs: 0 }; // non-stream: single shot
      return { choices: [{ message: { content: visible }, finish_reason: data?.choices?.[0]?.finish_reason || 'stop' }], usage: data?.usage };
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  }

  async function* attemptStream(k, params, signal, timing) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const timer = setTimeout(() => ac.abort(), requestTimeoutMs);
    const stripper = makeThinkStripper();
    try {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody(params, true)), signal: ac.signal });
      if (res.status !== 200) { let data = null; try { data = await res.json(); } catch {} const e = new Error(`http_${res.status}`); e.reason = httpToReason(res.status); e.httpStatus = res.status; e.baseStatus = data?.base_resp?.status_code; throw e; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let sse = '';
      const t0 = Date.now();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sse += dec.decode(value, { stream: true });
        let idx;
        while ((idx = sse.indexOf('\n')) >= 0) {
          const line = sse.slice(0, idx).trim();
          sse = sse.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload); } catch { continue; }
          // soft error mid-stream
          const bs = j?.base_resp?.status_code;
          const reason = statusToReason(bs);
          if (reason) { const e = new Error(`base_${bs}`); e.reason = reason; e.baseStatus = bs; throw e; }
          if (j.usage) recordUsage(k, j.usage);
          const d = j?.choices?.[0]?.delta?.content;
          if (d) {
            if (timing.firstRawTokenMs == null) timing.firstRawTokenMs = Date.now() - t0;
            const visible = stripper.push(d);
            if (visible) {
              if (timing.firstVisibleTokenMs == null) timing.firstVisibleTokenMs = Date.now() - t0;
              yield { choices: [{ delta: { content: visible } }] };
            }
          }
        }
      }
      const tail = stripper.flush();
      if (tail) yield { choices: [{ delta: { content: tail } }] };
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  }

  // ── retry/rotate orchestration (shared by stream + non-stream) ────────────────
  // Returns { key, run } where run() is invoked by the caller; on a retryable error
  // it rotates key + backs off. For streaming we must (re)create the generator per
  // attempt, so we accept a thunk that builds the attempt.
  async function withRotation(buildAttempt, isStream) {
    stats.calls++;
    let attempt = 0;
    let lastErr = null;
    while (attempt <= maxRetries) {
      // throttle EACH provider start (global QPM, not per key)
      await throttle.acquire();
      let k = nextKey();
      while (!k) { const more = await waitForAnyKey(); if (!more) { const e = new Error('all_keys_unavailable'); e.reason = 'exhausted'; throw e; } k = nextKey(); }
      k.calls++;
      try {
        return await buildAttempt(k);
      } catch (e) {
        lastErr = e;
        const reason = e.reason || 'transient';
        if (reason === 'auth_error') { k.authErrors++; k.key = null; invalidated++; console.warn(`[minimax] ${k.slot} ${k.maskedKey} auth_error → invalidated`); if (keys.every((x) => !x.key)) throw e; attempt++; continue; }
        if (reason === 'out_of_credits') { k.failures++; k.cooldownUntil = Date.now() + 6 * 60 * 60 * 1000; console.warn(`[minimax] ${k.slot} ${k.maskedKey} out_of_credits → cooled 6h`); attempt++; continue; }
        if (reason === 'rate_limited') { k.rateLimited++; stats.rateLimited++; k.cooldownUntil = Date.now() + keyCooldownMs; }
        else if (reason === 'bad_request') { k.failures++; stats.failures++; throw e; } // never retry a bad request
        else { k.failures++; stats.transient++; }
        attempt++; stats.retries++; k.retries++;
        if (attempt > maxRetries) break;
        await sleep(Math.round(retryBackoffBaseMs * Math.pow(1.7, attempt - 1) * (0.75 + 0.5 * ((stats.calls * 31 + attempt * 17) % 100) / 100)));
      }
    }
    stats.failures++;
    throw lastErr || new Error('minimax_failed');
  }

  const create = async (params, options = {}) => {
    const signal = options.signal;
    if (params.stream) {
      // Build a fresh attempt generator per try; expose as async-iterable.
      const timing = { firstRawTokenMs: null, firstVisibleTokenMs: null };
      const self = { firstError: null };
      async function* gen() {
        // We can't easily "retry" mid-iteration once tokens are yielded; so we
        // resolve the first chunk under rotation, then stream the rest. Practically:
        // run the whole attempt under withRotation, buffering nothing — if the FIRST
        // fetch fails we rotate; once streaming starts, a mid-stream soft error
        // surfaces as a thrown error the runner treats as empty (rare).
        const iterFactory = (k) => attemptStream(k, params, signal, timing);
        // withRotation needs an awaitable; we make buildAttempt return an iterator
        // after confirming the response opened (first read happens inside attemptStream
        // before any yield only on header). To keep it simple + robust we retry only
        // on errors thrown before the first yield by pre-opening via a wrapper.
        const it = await withRotation(async (k) => {
          // eagerly create the generator and prime it to surface header errors
          const g = iterFactory(k);
          const first = await g.next();
          return { g, first };
        }, true);
        lastTiming = timing;
        if (!it.first.done) yield it.first.value;
        for await (const chunk of it.g) yield chunk;
        lastTiming = timing;
      }
      return gen();
    }
    const out = await withRotation((k) => attemptNonStream(k, params, signal), false);
    return out;
  };

  return {
    chat: { completions: { create } },
    // introspection for the runner / reports
    getTiming: () => lastTiming,
    stats: () => ({ ...stats, invalidatedKeys: invalidated }),
    usage: () => keys.map((k) => ({ slot: k.slot, maskedKey: k.maskedKey, calls: k.calls, retries: k.retries, rateLimited: k.rateLimited, authErrors: k.authErrors, failures: k.failures, tokensIn: k.tokensIn, tokensOut: k.tokensOut, reasoningTokens: k.reasoningTokens, invalidated: !k.key })),
    keyCount: () => keys.filter((k) => k.key).length,
    allExhausted: () => keys.every((k) => !k.key || k.cooldownUntil > Date.now() + 60 * 60 * 1000),
  };
}
