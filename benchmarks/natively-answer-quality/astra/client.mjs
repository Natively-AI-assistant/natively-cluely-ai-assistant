// AgentRouter client for the external judge (OpenAI-compatible Chat Completions).
//
// The API key is read from the repo .env by parsing the file (never from argv, never printed).
// It lives only in this module's closure. Every string that leaves this module (errors, logs,
// stored records) passes through scrub(), which removes the key and any Authorization header text.
//
// Wire format: whatever astra/probe.mjs recorded in astra/probe-result.json. The judge refuses to
// run until that probe has succeeded against the exact model id, so nothing here is used on an
// assumed format. Optional OpenAI parameters the probe found unsupported are listed there and
// stripped from every request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The spec named https://co.agentrouter.org/v1; that host is a different gateway and answers this key with
// 401 "Invalid API Key!". The key belongs to https://agentrouter.org (measured by the agentrouter-provider
// session on 2026-09-30), which serves gpt-6-astra over the OpenAI protocol.
export const BASE_URL = process.env.ASTRA_BASE_URL || 'https://agentrouter.org/v1';
/**
 * CLIENT IDENTITY — AgentRouter answers only allow-listed coding tools (401 unauthorized_client_error otherwise).
 * Same single header the product integration sends (electron/llm/agentRouter.ts AGENTROUTER_CLIENT_HEADERS),
 * approved by Evin for this benchmark judge on 2026-09-30 ("Yes, full volume"), with the ToS/suspension risk stated.
 */
export const CLIENT_HEADERS = Object.freeze({ originator: 'codex_cli_rs' });
export const JUDGE_MODEL = 'gpt-6-astra';
export const KEY_VAR = 'AGENTROUTER_API_KEY';
// The app worktrees deliberately carry no .env; the key lives in the MAIN checkout's .env.
function findEnv() {
  if (process.env.NATIVELY_ENV_FILE) return process.env.NATIVELY_ENV_FILE;
  const local = path.resolve(HERE, '..', '..', '..', '.env');
  if (fs.existsSync(local)) return local;
  try {
    const common = execFileSync('git', ['-C', HERE, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const main = path.join(path.dirname(common), '.env');
    if (fs.existsSync(main)) return main;
  } catch { /* fall through */ }
  return local;
}
export const ENV_FILE = findEnv();
export const PROBE_FILE = path.join(HERE, 'probe-result.json');

let KEY = null;
function loadKey() {
  if (KEY) return KEY;
  let txt;
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch { throw new Error(`env file not readable (${path.basename(ENV_FILE)})`); }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== KEY_VAR) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) { KEY = v; return KEY; }
  }
  throw new Error(`${KEY_VAR} not found in env file`);
}

/** Remove the key (and anything shaped like a bearer header) from any text. */
export function scrub(s) {
  let out = String(s ?? '');
  if (KEY) out = out.split(KEY).join('[REDACTED]');
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_\-]{12,}/g, 'sk-[REDACTED]');
}

export function readProbe() {
  try { return JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8')); } catch { return null; }
}

/** Throws unless a successful probe against JUDGE_MODEL is on record. */
export function assertProbeOk() {
  const p = readProbe();
  if (!p || !p.ok || !p.model_listed || p.requested_model !== JUDGE_MODEL) {
    const why = !p ? 'no probe on record (run astra/probe.mjs)' : !p.model_listed ? `${JUDGE_MODEL} unavailable for this AgentRouter key` : 'last probe failed';
    throw new Error(`judge unavailable: ${why}`);
  }
  return p;
}

// ---- concurrency limiter ----
export function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

/**
 * One raw HTTP call. Returns { status, json, text, headers, latencyMs }.
 * Never throws with the key in the message.
 */
export async function rawCall(method, route, body, { timeoutMs = 120000 } = {}) {
  const key = loadKey();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(BASE_URL + route, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json', ...CLIENT_HEADERS },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
    const headers = {};
    for (const h of ['x-request-id', 'x-oneapi-request-id', 'openai-processing-ms', 'retry-after', 'content-type']) { const v = res.headers.get(h); if (v) headers[h] = v; }
    return { status: res.status, json, text: scrub(text).slice(0, 4000), headers, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: null, text: scrub(e?.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : e?.message ?? e), headers: {}, latencyMs: Date.now() - t0 };
  } finally { clearTimeout(t); }
}

/**
 * Chat completion with retries for transient failures (429/5xx/network), exponential backoff + jitter,
 * honouring Retry-After. Returns a record safe to store (no key, no headers other than ids).
 */
/** Set once AgentRouter answers 402 (GPT ration batch exhausted): every later call fails fast, so a run stops
 *  spending and resumes from the cache in the next batch (02:00 / 11:00 UTC). */
export let RATIONED = null;
/** Set once a route rejects temperature=0 (spec §19: drop only the rejected optional parameter). */
export let TEMPERATURE_REJECTED = false;
export async function chat(messages, { maxTokens = 4000, temperature = 0, retries = 5, timeoutMs = 180000 } = {}) {
  if (RATIONED) return { ok: false, rationed: true, status: 402, error: RATIONED, requested_model: JUDGE_MODEL, attempts: 0, at: new Date().toISOString() };
  const probe = assertProbeOk();
  const unsupported = new Set(probe.unsupported_params ?? []);
  const body = { model: JUDGE_MODEL, messages, stream: false };
  if (!unsupported.has('temperature') && !TEMPERATURE_REJECTED) body.temperature = temperature;
  const tokParam = probe.token_param ?? 'max_tokens';
  if (!unsupported.has(tokParam)) body[tokParam] = maxTokens;
  let attempt = 0; let last = null; let droppedTemperature = false;
  while (attempt <= retries) {
    const r = await rawCall('POST', '/chat/completions', body, { timeoutMs });
    last = r;
    if (r.status === 200 && r.json) {
      const choice = r.json.choices?.[0];
      const content = typeof choice?.message?.content === 'string' ? choice.message.content
        : Array.isArray(choice?.message?.content) ? choice.message.content.map((p) => p?.text ?? '').join('') : null;
      return {
        ok: content != null,
        content,
        requested_model: JUDGE_MODEL,
        returned_model: r.json.model ?? null,
        model_mismatch: !!r.json.model && r.json.model !== JUDGE_MODEL,
        response_id: r.json.id ?? null,
        request_id: r.headers['x-request-id'] ?? r.headers['x-oneapi-request-id'] ?? null,
        finish_reason: choice?.finish_reason ?? null,
        usage: r.json.usage ?? null,
        latency_ms: r.latencyMs,
        temperature: 'temperature' in body ? body.temperature : 'default',
        temperature_dropped: droppedTemperature || TEMPERATURE_REJECTED,
        attempts: attempt + 1,
        at: new Date().toISOString(),
      };
    }
    // Spec §19: an OPTIONAL parameter the route rejects is dropped (only that one); the model never changes.
    // Measured 11:0xZ: some gpt-6-astra routes answer 400 "Unsupported value: 'temperature' does not support 0.0 with
    // this model. Only the default (1) value is supported" while others accept 0.
    if (r.status === 400 && 'temperature' in body && /temperature/i.test(r.text)) {
      TEMPERATURE_REJECTED = true; delete body.temperature; droppedTemperature = true;
      console.error('[astra] route rejected temperature=0; retrying without it (default temperature)');
      continue;
    }
    if (r.status === 402) { RATIONED = `402 ration exhausted at ${new Date().toISOString()}: ${scrub(r.text).slice(0, 160)}`; console.error(`[astra] ${RATIONED} — stopping new judge calls`); break; }
    if (!(r.status === 0 || TRANSIENT.has(r.status))) break;
    const ra = Number(r.headers['retry-after']);
    const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 1500 * 2 ** attempt);
    await sleep(backoff * (0.75 + Math.random() * 0.5));
    attempt++;
  }
  return { ok: false, status: last?.status ?? null, error: scrub(last?.text ?? 'unknown').slice(0, 600), requested_model: JUDGE_MODEL, attempts: attempt + 1, at: new Date().toISOString() };
}
