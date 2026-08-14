/**
 * tokenrouter-keypool.mjs — loads + validates + masks TokenRouter API keys from .env.
 * TokenRouter is an OpenAI-compatible gateway to MiniMax (unlimited M3 usage). The
 * provider client (minimax-provider.mjs) is endpoint/model-agnostic, so we just point
 * it at the TokenRouter base URL + MiniMax-M3 and reuse the same <think> stripper.
 *
 * Key formats: TOKENROUTER_API_KEY, TOKENROUTER_API_KEY_1..N, TOKENROUTER_API_KEYS=a,b,c
 * SECURITY: a raw key is NEVER printed/logged/persisted — only maskKey() = "****<last4>".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export const TR_BASE_URL = (() => {
  try { const env = readDotEnv(); return (env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com').replace(/\/$/, ''); } catch { return 'https://api.tokenrouter.com'; }
})();
export const TR_MODEL = (() => { try { return readDotEnv().TOKENROUTER_MODEL || 'MiniMax-M3'; } catch { return 'MiniMax-M3'; } })();
export const TR_CHAT_URL = `${TR_BASE_URL}/v1/chat/completions`;
export const EVAL_MODEL = TR_MODEL;

export function maskKey(k) { if (!k || typeof k !== 'string') return '(none)'; return '****' + k.slice(-4); }

function readDotEnv() {
  const p = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function loadTokenRouterKeys() {
  const env = { ...readDotEnv(), ...process.env };
  const slots = []; const seen = new Set();
  const push = (slot, val) => { const v = (val || '').trim(); if (!v || seen.has(v)) return; seen.add(v); slots.push({ slot, key: v }); };
  push('TOKENROUTER_API_KEY', env.TOKENROUTER_API_KEY);
  for (let i = 1; i <= 24; i++) push(`TOKENROUTER_API_KEY_${i}`, env[`TOKENROUTER_API_KEY_${i}`]);
  if (env.TOKENROUTER_API_KEYS) env.TOKENROUTER_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean).forEach((k, idx) => push(`TOKENROUTER_API_KEYS[${idx}]`, k));
  return slots;
}

export async function validateKeys({ model = TR_MODEL, timeoutMs = 30000 } = {}) {
  const slots = loadTokenRouterKeys();
  const usable = []; const report = [];
  for (const s of slots) {
    const r = await healthCheck(s.key, { model, timeoutMs });
    report.push({ slot: s.slot, maskedKey: maskKey(s.key), ok: r.ok, httpStatus: r.httpStatus, baseStatus: r.baseStatus, latencyMs: r.latencyMs, reason: r.reason });
    if (r.ok) usable.push({ slot: s.slot, key: s.key, maskedKey: maskKey(s.key) });
    console.log(`[tokenrouter-keypool] ${s.slot} ${maskKey(s.key)} → ${r.ok ? 'USABLE' : 'UNUSABLE'} (http ${r.httpStatus}${r.baseStatus != null ? `, base ${r.baseStatus}` : ''}${r.latencyMs ? `, ${r.latencyMs}ms` : ''})${r.reason ? ' · ' + r.reason : ''}`);
  }
  return { slotsDetected: slots.length, usableCount: usable.length, usable, report };
}

async function healthCheck(key, { model, timeoutMs }) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs); const t0 = Date.now();
  try {
    const res = await fetch(TR_CHAT_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 512, temperature: 0.1, stream: false }), signal: ac.signal });
    const latencyMs = Date.now() - t0;
    let data = null; try { data = await res.json(); } catch {}
    const baseStatus = data?.base_resp?.status_code;
    const ok = res.status === 200 && (baseStatus == null || baseStatus === 0);
    let reason = null;
    if (!ok) { if (res.status === 401 || res.status === 403) reason = 'auth_error'; else if (res.status === 429) reason = 'rate_limited'; else reason = `http_${res.status}${baseStatus != null ? `_base_${baseStatus}` : ''}`; }
    return { ok, httpStatus: res.status, baseStatus, latencyMs, reason };
  } catch (e) { return { ok: false, httpStatus: 0, baseStatus: null, latencyMs: Date.now() - t0, reason: e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 80) }; }
  finally { clearTimeout(timer); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = await validateKeys({});
  console.log(`\n[tokenrouter-keypool] ${v.slotsDetected} detected · ${v.usableCount} usable · endpoint ${TR_CHAT_URL} · model ${TR_MODEL}`);
  process.exit(v.usableCount ? 0 : 3);
}
