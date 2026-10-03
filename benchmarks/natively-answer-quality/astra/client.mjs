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
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';

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
/**
 * WHICH JUDGE (2026-10-01 22:40Z). gpt-6-astra over AgentRouter was the only judge until the account's quota ran out;
 * Evin then asked for the Fable model as the judge ("use fable model as the judge and continue optimisations").
 * AQ_JUDGE=fable selects it. Nothing else changes: same charter, same envelope, same schema, same official score.
 * The two judges' scores are separate series and are never pooled: the cache key carries the judge (JUDGE_KEY),
 * replay judgments go to their own file (JUDGED_SUFFIX) and absolute sets get their own names (abs-*-f1).
 * Transport for Fable: the local `claude` CLI, headless, one fresh process per judgment with every customisation
 * off (no CLAUDE.md, memory, hooks, skills or MCP servers), no tools, the charter as the whole system prompt and a
 * neutral working directory — so a judgment sees the charter and the envelope and nothing of the session that is
 * doing the optimising. No key is read or sent by this path (the CLI's own login is used).
 */
// 2026-10-02 01:00Z — Evin: "use gpt astra 6 only revert from using fable model". The judge is gpt-6-astra and
// nothing else. The Fable backend below is kept as the record of how the `*-f1` series was produced, and refuses to
// run: no new judgment may come from it.
if (process.env.AQ_JUDGE === 'fable') {
  console.error('judge unavailable: the Fable judge was withdrawn on 2026-10-02 (the judge is gpt-6-astra only). Unset AQ_JUDGE.');
  process.exit(2);
}
// 2026-10-03 — Evin, on the two branches left out of the landing: "try those branchs side by side and see if its
// required use claude opus 5.5 as the judge from claude code". AQ_JUDGE=opus selects Claude Opus 5.5 over the same
// headless-CLI transport the Fable trial used. It is a second opinion on those branches only: gpt-6-astra stays the
// default and the judge of record, and the Opus series has its own cache key and its own files, never pooled.
export const JUDGE = process.env.AQ_JUDGE === 'opus' ? 'opus' : 'astra';
/** A judge reached through the headless Claude Code CLI instead of AgentRouter (no key is read or sent). */
export const VIA_CLI = JUDGE !== 'astra';
export const FABLE_EFFORT = process.env.AQ_FABLE_EFFORT || 'medium';
/** One fixed effort for the Opus judge: it is part of the cache key, so it cannot drift within a series. */
export const CLI_EFFORT = 'medium';
export const JUDGE_MODEL = JUDGE === 'opus' ? 'claude-opus-5-5' : 'gpt-6-astra';
/** What the caches are keyed by. Unchanged for gpt-6-astra, so its existing cache stays valid. */
export const JUDGE_KEY = VIA_CLI ? `${JUDGE_MODEL}/effort-${CLI_EFFORT}` : JUDGE_MODEL;
export const JUDGED_SUFFIX = JUDGE === 'opus' ? '.judged-opus.jsonl' : '.judged.jsonl';
// 2026-10-02 04:35Z — Evin: "theres a second api key for agentrouter". The first key's ACCOUNT ran out of quota on
// 2026-10-01 12:26Z and the 02:00Z batch did not restore it. Same gateway, same model id, same client header: the
// judge does not change, only whose quota pays for the call. A key that reports its quota (or its ration batch)
// spent hands over to the next one; new calls stop only when every key has said so. Names only, never values.
export const KEY_VARS = Object.freeze(['AGENTROUTER_API_KEY', 'AGENTROUTER_API_KEY_1']);
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

/** [{ name, value }] in KEY_VARS order; a value repeated under a second name counts once. */
let KEYS = null;
function loadKeys() {
  if (KEYS) return KEYS;
  let txt;
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch { throw new Error(`env file not readable (${path.basename(ENV_FILE)})`); }
  const found = new Map();
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || !KEY_VARS.includes(m[1]) || found.has(m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) found.set(m[1], v);
  }
  const keys = [];
  for (const name of KEY_VARS) {
    const value = found.get(name);
    if (value && !keys.some((k) => k.value === value)) keys.push({ name, value });
  }
  if (!keys.length) throw new Error(`${KEY_VARS.join(' / ')} not found in env file`);
  KEYS = keys;
  return KEYS;
}

/** Remove every key (and anything shaped like a bearer header) from any text. */
export function scrub(s) {
  let out = String(s ?? '');
  for (const k of KEYS ?? []) out = out.split(k.value).join('[REDACTED]');
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_\-]{12,}/g, 'sk-[REDACTED]');
}

export function readProbe() {
  try { return JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8')); } catch { return null; }
}

// Which key is in use. It starts at the key the last successful probe answered on, so a process does not spend
// its first calls on a key already known to be out of quota.
let ACTIVE = -1;
const SPENT = new Set();
function activeIndex() {
  const keys = loadKeys();
  if (ACTIVE < 0) {
    const p = readProbe();
    const i = p?.ok ? keys.findIndex((k) => k.name === p.key_var) : -1;
    ACTIVE = i >= 0 ? i : 0;
  }
  return ACTIVE;
}
/** The variable NAMES of the keys present, in order. */
export const keyVars = () => loadKeys().map((k) => k.name);
/** The variable NAME of the key in use. */
export const activeKeyVar = () => loadKeys()[activeIndex()].name;
/**
 * The key at `index` reported its quota or ration spent. Moves to a key that has not, if there is one.
 * Returns true when a call made on `index` should be repeated (another key is now in use).
 */
export function keySpent(index) {
  const keys = loadKeys();
  SPENT.add(index);
  if (activeIndex() !== index) return !SPENT.has(ACTIVE);
  const next = keys.findIndex((_, i) => !SPENT.has(i));
  if (next < 0) return false;
  console.error(`[astra] ${keys[index].name} is out of quota — continuing on ${keys[next].name}`);
  ACTIVE = next;
  return true;
}

/** Throws unless a successful probe against JUDGE_MODEL is on record. */
export function assertProbeOk() {
  if (VIA_CLI) return { ok: true, model_listed: true, requested_model: JUDGE_MODEL, returned_model: JUDGE_MODEL, unsupported_params: [] };
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
 * One raw HTTP call. Returns { status, json, text, headers, latencyMs, keyIndex, keyVar }.
 * Never throws with the key in the message. `keyIndex` picks a key by position (the probe tries each one);
 * without it the key in use is taken.
 */
export async function rawCall(method, route, body, { timeoutMs = 120000, keyIndex = activeIndex() } = {}) {
  const { name: keyVar, value: key } = loadKeys()[keyIndex];
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
    return { status: res.status, json, text: scrub(text).slice(0, 4000), headers, latencyMs: Date.now() - t0, keyIndex, keyVar };
  } catch (e) {
    return { status: 0, json: null, text: scrub(e?.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : e?.message ?? e), headers: {}, latencyMs: Date.now() - t0, keyIndex, keyVar };
  } finally { clearTimeout(t); }
}

/**
 * Chat completion with retries for transient failures (429/5xx/network), exponential backoff + jitter,
 * honouring Retry-After. Returns a record safe to store (no key, no headers other than ids).
 */
/** Set once AgentRouter answers 402 (GPT ration batch exhausted): every later call fails fast, so a run stops
 *  spending and resumes from the cache in the next batch (02:00 / 11:00 UTC). */
export let RATIONED = null;
/** A judgment that cannot be saved is a ration call spent for nothing: below this much free space on the volume the
 *  harness writes to, no new call starts (2026-10-02 09:02Z: 0.8 GB free, 100 % full, two hours before a batch). */
export const DISK_FLOOR_MB = Number(process.env.AQ_DISK_FLOOR_MB ?? 300);
export function freeDiskMb() {
  try { const s = fs.statfsSync(HERE); return (Number(s.bavail) * Number(s.bsize)) / 1048576; } catch { return Infinity; }
}
/** A dip passes (another build on the same disk, swap): hold the call for up to DISK_WAIT_MS before giving up.
 *  2026-10-02 11:06Z: free space went 5.7 GB → 0.29 GB → 1.65 GB within five minutes and ended a calibration. */
export const DISK_WAIT_MS = Number(process.env.AQ_DISK_WAIT_MS ?? 20 * 60000);
let DISK_HOLD = false;
async function diskRoom() {
  const until = Date.now() + DISK_WAIT_MS;
  let mb = freeDiskMb();
  while (mb < DISK_FLOOR_MB && Date.now() < until && !RATIONED) {
    if (!DISK_HOLD) { DISK_HOLD = true; console.error(`[astra] disk low (${Math.round(mb)} MB free) — holding judge calls until there is room`); }
    await new Promise((r) => setTimeout(r, 5000));
    mb = freeDiskMb();
  }
  if (mb >= DISK_FLOOR_MB) DISK_HOLD = false;
  return mb;
}
/** Stop new judge calls for a reason that is not the ration. queue3.mjs stops on the same line. */
export function stopNewCalls(reason) {
  if (RATIONED) return;
  RATIONED = `${reason} at ${new Date().toISOString()}`;
  console.error(`[astra] ${RATIONED} — stopping new judge calls`);
}
/** Set once a route rejects temperature=0 (spec §19: drop only the rejected optional parameter). */
export let TEMPERATURE_REJECTED = false;
export async function chat(messages, { maxTokens = 4000, temperature = 0, retries = 5, timeoutMs = 180000 } = {}) {
  if (VIA_CLI) return chatFable(messages, { retries: Math.min(retries, 3), timeoutMs: Math.max(timeoutMs, 300000) });
  if (!RATIONED) { const mb = await diskRoom(); if (mb < DISK_FLOOR_MB) stopNewCalls(`disk nearly full (${Math.round(mb)} MB free)`); }
  if (RATIONED) return { ok: false, rationed: true, status: RATIONED.startsWith('disk') ? null : 402, error: RATIONED, requested_model: JUDGE_MODEL, attempts: 0, at: new Date().toISOString() };
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
        key_var: r.keyVar,
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
    // 2026-10-01 12:26Z: a second way a batch ends — the ACCOUNT's own balance, not the GPT ration pool:
    // {"error":{"message":"user quota is not enough","code":"insufficient_user_quota"}}. It is not a 402, so every
    // remaining row failed one by one. Same handling: fail fast from here on; the wording keeps the two apart.
    const accountSpent = /insufficient_user_quota|user quota is not enough/i.test(r.text);
    if (r.status === 402 || accountSpent) {
      // Another key may still have quota: repeat this call on it (not counted as a retry).
      if (keySpent(r.keyIndex)) continue;
      RATIONED = accountSpent ? `account quota exhausted (insufficient_user_quota) at ${new Date().toISOString()}` : `402 ration exhausted at ${new Date().toISOString()}: ${scrub(r.text).slice(0, 160)}`;
      console.error(`[astra] ${RATIONED} — stopping new judge calls`);
      break;
    }
    if (!(r.status === 0 || TRANSIENT.has(r.status))) break;
    const ra = Number(r.headers['retry-after']);
    const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 1500 * 2 ** attempt);
    await sleep(backoff * (0.75 + Math.random() * 0.5));
    attempt++;
  }
  return { ok: false, status: last?.status ?? null, error: scrub(last?.text ?? 'unknown').slice(0, 600), requested_model: JUDGE_MODEL, attempts: attempt + 1, at: new Date().toISOString() };
}

// ---- A Claude model through the headless CLI (built for the Fable trial; AQ_JUDGE=opus uses it) ----
let FABLE_DIR = null;
function fableSystemFile(system) {
  FABLE_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'aq-fable-judge-'));
  const f = path.join(FABLE_DIR, `${crypto.createHash('sha256').update(system).digest('hex').slice(0, 12)}.txt`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, system);
  return f;
}
function runClaude(system, prompt, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = ['-p', '--model', JUDGE_MODEL, '--effort', CLI_EFFORT, '--safe-mode', '--tools', '', '--system-prompt-file', fableSystemFile(system), '--no-session-persistence', '--output-format', 'json'];
    // CLAUDECODE etc. describe the parent session; the judge process gets none of it.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_CODE_|^CLAUDECODE$/.test(k)));
    const child = spawn('claude', args, { cwd: FABLE_DIR, env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = ''; let err = ''; let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ ...r, latencyMs: Date.now() - t0 }); };
    const timer = setTimeout(() => { child.kill(); finish({ code: -1, out, err: `timeout after ${timeoutMs} ms` }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ code: -1, out, err: String(e?.message ?? e) }));
    child.on('close', (code) => finish({ code, out, err }));
    child.stdin.on('error', () => { /* the process ended before reading */ });
    child.stdin.end(prompt);
  });
}
const FABLE_LIMIT_RE = /usage limit|limit reached|out of (?:extra )?usage|exceeded your|credit balance|quota/i;
async function chatFable(messages, { retries = 3, timeoutMs = 300000 } = {}) {
  if (RATIONED) return { ok: false, rationed: true, status: 429, error: RATIONED, requested_model: JUDGE_MODEL, attempts: 0, at: new Date().toISOString() };
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  // One prompt per process: a repair turn is sent as the original request, the earlier output and the repair request.
  const prompt = rest.length === 1 ? rest[0].content
    : rest.map((m, i) => (m.role === 'assistant' ? `--- YOUR PREVIOUS OUTPUT ---\n${m.content}\n--- END OF PREVIOUS OUTPUT ---` : i === 0 ? m.content : m.content)).join('\n\n');
  let attempt = 0; let last = null;
  while (attempt <= retries) {
    const r = await runClaude(system, prompt, timeoutMs);
    let j = null; try { j = JSON.parse(r.out); } catch { /* not JSON: an error line */ }
    const text = j ? String(j.result ?? '') : `${r.out}\n${r.err}`.trim();
    last = { status: r.code, text: text.slice(0, 600) };
    if (r.code === 0 && j && j.is_error === false && typeof j.result === 'string' && j.result.trim()) {
      const models = Object.keys(j.modelUsage ?? {});
      return {
        ok: true, content: j.result, requested_model: JUDGE_MODEL, returned_model: models.join(',') || null,
        model_mismatch: !models.includes(JUDGE_MODEL), response_id: j.session_id ?? null, request_id: null,
        finish_reason: j.stop_reason ?? j.subtype ?? null,
        usage: j.usage ? { input_tokens: j.usage.input_tokens, cache_read_input_tokens: j.usage.cache_read_input_tokens, cache_creation_input_tokens: j.usage.cache_creation_input_tokens, output_tokens: j.usage.output_tokens } : null,
        latency_ms: r.latencyMs, temperature: 'default', effort: CLI_EFFORT, temperature_dropped: false, attempts: attempt + 1, at: new Date().toISOString(),
      };
    }
    if (FABLE_LIMIT_RE.test(text)) { RATIONED = `${JUDGE} usage limit at ${new Date().toISOString()}: ${text.slice(0, 160)}`; console.error(`[${JUDGE}] ${RATIONED} — stopping new judge calls`); break; }
    await sleep(Math.min(60000, 3000 * 2 ** attempt) * (0.75 + Math.random() * 0.5));
    attempt++;
  }
  return { ok: false, status: last?.status ?? null, error: String(last?.text ?? 'unknown').slice(0, 600), requested_model: JUDGE_MODEL, attempts: attempt + 1, at: new Date().toISOString() };
}
