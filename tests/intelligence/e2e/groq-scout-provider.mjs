/**
 * groq-scout-provider.mjs — a rotating, retrying, scout-pinned Groq client that is
 * a drop-in for the `groq-sdk` surface the app's LLMHelper uses
 * (`client.chat.completions.create({ ..., stream })`).
 *
 * WHY: the real backend path (LLMHelper._streamChatInner) calls
 * `this.groqClient.chat.completions.create(...)`. By injecting THIS object as
 * `llmHelper.groqClient` and setting `currentModelId` to the scout model, every
 * manual/WTA/coding answer flows through the production decision+context+sanitize
 * layer but is actually served by Groq scout across an 8-key rotating pool with
 * 429/5xx backoff. Nothing in the decision layer is mocked.
 *
 * SECURITY: keys are held only inside the KeyScheduler; this module emits only
 * masked slot usage. The chosen key is set on the per-request Authorization header
 * via a fresh groq-sdk instance per slot (cached), never logged.
 */
import GroqSdk from 'groq-sdk';
import { KeyScheduler, EVAL_MODEL } from './groq-keypool.mjs';

const Groq = GroqSdk.default || GroqSdk;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function statusOf(err) {
  return err?.status || err?.statusCode || err?.response?.status || 0;
}

/**
 * Build the injectable client.
 * @param {Array<{slot,key,masked}>} usableKeys validated key pool
 * @param {object} opts { model, maxRetries, retryBackoffMs, perKeyCooldownMs, onCall }
 */
export function createRotatingGroqClient(usableKeys, opts = {}) {
  const model = opts.model || EVAL_MODEL;
  const maxRetries = opts.maxRetries ?? 3;
  const baseBackoff = opts.retryBackoffMs ?? 1500;
  const scheduler = new KeyScheduler(usableKeys, { perKeyCooldownMs: opts.perKeyCooldownMs ?? 250 });

  // ── TPM (tokens-per-minute) pacing ──
  // Groq scout free tier = 30000 tokens/min PER KEY. The Natively system prompt +
  // coding context is large, so an unpaced burst drains a key's token bucket and
  // Groq then SILENTLY QUEUES the stream (200, no 429) → the app's 7s first-useful
  // deadline fires → empty. We keep each key under a safe TPM ceiling by tracking a
  // rolling-60s estimated token spend per key and gating acquisition on headroom.
  const TPM_LIMIT = opts.tpmLimitPerKey ?? 30000;
  const TPM_SAFETY = opts.tpmSafety ?? 0.82;             // stay under 82% of the cap
  const TPM_CEIL = Math.floor(TPM_LIMIT * TPM_SAFETY);
  // Groq bills TPM against max_tokens (the OUTPUT RESERVATION), not actual output.
  // The app hardcodes max_tokens:8192 → ~10k tokens billed per coding request →
  // only ~3 req/key/min before Groq queues the stream past the 7s deadline. We clamp
  // max_tokens to a realistic ceiling (scout's coding answers finish well under this,
  // so the ANSWER is unchanged — only the wasteful reservation shrinks) and we count
  // that reservation in the TPM estimate so pacing is accurate.
  const MAX_OUTPUT_TOKENS = opts.maxOutputTokens ?? 2048;
  const spendBySlot = new Map();                          // slot → [{ t, tokens }]
  const estTokens = (params) => {
    let chars = 0;
    for (const m of params.messages || []) {
      if (typeof m.content === 'string') chars += m.content.length;
      else if (Array.isArray(m.content)) for (const p of m.content) chars += (p?.text?.length || 0);
    }
    const inputTokens = Math.ceil(chars / 3.5);          // ~3.5 chars/token
    const reserved = Math.min(params.max_tokens || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
    return inputTokens + reserved;                        // Groq bills input + max_tokens
  };
  const slotSpend = (slot, now) => {
    const arr = (spendBySlot.get(slot) || []).filter((e) => now - e.t < 60000);
    spendBySlot.set(slot, arr);
    return arr.reduce((a, e) => a + e.tokens, 0);
  };
  const recordSpend = (slot, tokens) => {
    const now = Date.now();
    const arr = spendBySlot.get(slot) || [];
    arr.push({ t: now, tokens });
    spendBySlot.set(slot, arr);
  };

  // One groq-sdk instance per slot (each pinned to its own key), created lazily.
  const sdkBySlot = new Map();
  const sdkFor = (cand) => {
    let s = sdkBySlot.get(cand.slot);
    if (!s) { s = new Groq({ apiKey: cand.key, maxRetries: 0 }); sdkBySlot.set(cand.slot, s); }
    return s;
  };

  const stats = { calls: 0, retries: 0, rateLimited: 0, serverErr: 0, failures: 0, pacedWaits: 0 };

  // Acquire a key that has TPM headroom for `need` tokens; if none, wait for the
  // least-loaded key's oldest spend to age out of the 60s window.
  async function acquireWithBudget(need) {
    for (let guard = 0; guard < 600; guard++) {
      const cand = await scheduler.acquire();
      const now = Date.now();
      if (slotSpend(cand.slot, now) + need <= TPM_CEIL) return cand;
      scheduler.release(cand.slot);
      // find global min headroom wait across all keys
      let minWait = 1500;
      for (const k of scheduler.pool) {
        const arr = (spendBySlot.get(k.slot) || []).filter((e) => now - e.t < 60000);
        if (!arr.length) { minWait = 0; break; }
        const used = arr.reduce((a, e) => a + e.tokens, 0);
        if (used + need <= TPM_CEIL) { minWait = 0; break; }
        const oldest = arr[0].t;
        minWait = Math.min(minWait, Math.max(50, 60000 - (now - oldest) + 20));
      }
      if (minWait > 0) { stats.pacedWaits++; await new Promise((r) => setTimeout(r, Math.min(minWait, 2000))); }
    }
    return scheduler.acquire();
  }

  async function createOnce(params) {
    let lastErr;
    const need = estTokens(params);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const cand = await acquireWithBudget(need);
      try {
        stats.calls++;
        recordSpend(cand.slot, need);
        const sdk = sdkFor(cand);
        // Clamp the output reservation: shrinks the Groq TPM bill without truncating
        // real answers (scout finishes coding answers well under MAX_OUTPUT_TOKENS).
        const clampedMax = Math.min(params.max_tokens || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
        const res = await sdk.chat.completions.create({ ...params, model, max_tokens: clampedMax });
        scheduler.release(cand.slot);
        if (opts.onCall) opts.onCall({ slot: cand.slot, masked: cand.masked, stream: !!params.stream });
        return res;
      } catch (err) {
        const status = statusOf(err);
        if (status === 429) { stats.rateLimited++; scheduler.penalize(cand.slot, 6000); recordSpend(cand.slot, TPM_CEIL); }
        else if (RETRYABLE.has(status)) { stats.serverErr++; scheduler.penalize(cand.slot, 3000); }
        else { scheduler.release(cand.slot); }
        lastErr = err;
        if (!RETRYABLE.has(status) || attempt === maxRetries) break;
        stats.retries++;
        const wait = baseBackoff * Math.pow(1.6, attempt);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    stats.failures++;
    throw lastErr || new Error('groq rotating client: exhausted retries');
  }

  return {
    // Mirror the groq-sdk shape LLMHelper touches.
    chat: { completions: { create: (params, _http) => createOnce(params) } },
    __scheduler: scheduler,
    usage: () => scheduler.usage(),
    stats: () => ({ ...stats }),
  };
}
