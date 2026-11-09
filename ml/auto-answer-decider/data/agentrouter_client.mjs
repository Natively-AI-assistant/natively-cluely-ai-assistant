/**
 * AgentRouter Responses-API client for the Phase 1 teacher and generator (decision D3, 2026-11-10).
 *
 * The key comes from AGENTROUTER_API_KEY in the environment. It is never written anywhere.
 * Gateway rules come from electron/llm/agentRouter.ts:
 *   - GPT ids are Responses-API only.
 *   - `originator: codex_cli_rs` is required (Evin's 2026-09-30 decision).
 *   - Every call streams.
 *   - 402 "Budget pool quota has been exhausted": the day's GPT batch is gone. Batches are
 *     released at 02:00 and 11:00 UTC, so wait for the next one.
 *   - 429: rate limit; back off.
 *   - 401 unauthorized_client_error / invalid token: stop, retrying cannot help.
 *   - 503 "no available channel": the model is retired; stop.
 * Pacing: at most one request in flight per caller, plus MIN_GAP_MS between request starts,
 * so the run is not "automated polling" at full speed.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../package.json'));
const OpenAI = require('openai').default ?? require('openai');

export const MODEL = process.env.DECIDER_TEACHER_MODEL || 'gpt-6.1-sol';
const MIN_GAP_MS = Number(process.env.DECIDER_MIN_GAP_MS || 1500);

export class FatalGatewayError extends Error {}

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.AGENTROUTER_API_KEY;
  if (!apiKey) throw new FatalGatewayError('AGENTROUTER_API_KEY is not set');
  client = new OpenAI({ apiKey, baseURL: 'https://agentrouter.org/v1', maxRetries: 0, timeout: 180_000, defaultHeaders: { originator: 'codex_cli_rs' } });
  return client;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastStart = 0;
async function pace() {
  const wait = lastStart + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
}

/** ms until the next 02:00 / 11:00 UTC batch release, plus 2 min of slack. */
export function msToNextBatch(now = new Date()) {
  const t = now.getTime();
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const marks = [2, 11, 26].map((h) => day + h * 3600_000);
  const next = marks.find((m) => m > t);
  return next - t + 120_000;
}

export const stats = { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, retries: 0, quotaWaits: 0, ms: 0 };

/**
 * One call. Returns { text, usage, ms }. Retries 429/5xx/network with backoff and waits out 402.
 * Throws FatalGatewayError for auth or retired-model errors.
 */
export async function respond({ instructions, input, effort = 'low', maxOutputTokens = 4000, log = () => {} }) {
  let attempt = 0;
  for (;;) {
    await pace();
    const t0 = Date.now();
    try {
      const stream = await getClient().responses.create({
        model: MODEL,
        ...(instructions ? { instructions } : {}),
        input,
        reasoning: { effort },
        max_output_tokens: maxOutputTokens,
        stream: true,
        store: false,
      });
      let text = '';
      let usage = null;
      let incomplete = null;
      for await (const ev of stream) {
        if (!ev) continue;                          // the gateway sends literal `data: null`
        if (ev.type === 'response.output_text.delta') text += ev.delta;
        else if (ev.type === 'response.completed') usage = ev.response?.usage ?? null;
        else if (ev.type === 'response.incomplete') {
          // max_output_tokens spent (often on reasoning) or the upstream content filter
          usage = ev.response?.usage ?? null;
          incomplete = ev.response?.incomplete_details?.reason ?? 'unknown';
        }
        else if (ev.type === 'response.failed' || ev.type === 'error') {
          throw Object.assign(new Error(ev.response?.error?.message || ev.message || 'response failed'), { status: 500 });
        }
      }
      const ms = Date.now() - t0;
      stats.calls++; stats.ms += ms;
      if (usage) {
        stats.inputTokens += usage.input_tokens ?? 0;
        stats.outputTokens += usage.output_tokens ?? 0;
        stats.reasoningTokens += usage.output_tokens_details?.reasoning_tokens ?? 0;
      }
      if (incomplete) stats.incomplete = (stats.incomplete ?? 0) + 1;
      return { text, usage, ms, incomplete };
    } catch (e) {
      if (e instanceof FatalGatewayError) throw e;
      const status = e.status ?? 0;
      const msg = String(e.message || e);
      if (status === 401 || /unauthorized|无效的令牌|未提供令牌|insufficient_user_quota/i.test(msg)) throw new FatalGatewayError(`auth/quota: ${msg.slice(0, 200)}`);
      if (status === 503 && /无可用渠道|no available channel/i.test(msg)) throw new FatalGatewayError(`model unavailable: ${msg.slice(0, 200)}`);
      if (status === 400 && /content-blocked/i.test(msg)) throw Object.assign(new Error('content-blocked'), { contentBlocked: true });
      if (status === 402 || /Budget pool quota/i.test(msg)) {
        const wait = msToNextBatch();
        stats.quotaWaits++;
        log(`402 budget pool exhausted; waiting ${(wait / 60000).toFixed(0)} min for the next batch`);
        await sleep(wait);
        continue;
      }
      attempt++;
      stats.retries++;
      if (attempt > 6) throw e;
      const backoff = Math.min(120_000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
      log(`retry ${attempt} after ${status || 'network'}: ${msg.slice(0, 120)} (sleep ${backoff} ms)`);
      await sleep(backoff);
    }
  }
}

/** First JSON object or array in a reply (models sometimes wrap it in a code fence). */
export function parseJsonReply(text) {
  const s = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  for (let end = s.length; end > start; end--) {
    const ch = s[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(s.slice(start, end)); } catch { /* keep shrinking */ }
  }
  return null;
}
