/**
 * minimax-keypool.mjs — loads + validates + masks MiniMax API keys from .env.
 *
 * Supports every key format the prompt lists:
 *   MINIMAX_API_KEY, MINIMAX_API_KEY_1..N, MINIMAX_API_KEYS=a,b,c
 *   MINIMAX_TOKEN, MINIMAX_TOKEN_1..N, MINIMAX_TOKENS=a,b,c
 *
 * SECURITY: a raw key is NEVER printed, logged, or written to disk. Every public
 * surface (console, usage JSON, returned slot objects) carries only maskKey(k) =
 * "****<last4>" + the slot NAME (e.g. MINIMAX_API_KEY_3). The raw value lives only
 * inside the in-memory `usable[i].key` field that the provider reads directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export const EVAL_MODEL = 'MiniMax-M2.7';
export const MINIMAX_CHAT_URL = 'https://api.minimax.io/v1/chat/completions';
export const MINIMAX_MODELS_URL = 'https://api.minimax.io/v1/models';

/** "****abcd" — the ONLY representation of a key allowed to leave this module. */
export function maskKey(k) {
  if (!k || typeof k !== 'string') return '(none)';
  return '****' + k.slice(-4);
}

/** Parse KEY=VALUE lines from .env without dragging in a dep. */
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

/**
 * loadMiniMaxKeys() → [{ slot, key }] de-duplicated, preserving discovery order.
 * Merges process.env over .env so an exported key wins.
 */
export function loadMiniMaxKeys() {
  const env = { ...readDotEnv(), ...process.env };
  const slots = [];
  const seen = new Set();
  const push = (slot, val) => {
    const v = (val || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    slots.push({ slot, key: v });
  };

  // Singletons
  push('MINIMAX_API_KEY', env.MINIMAX_API_KEY);
  push('MINIMAX_TOKEN', env.MINIMAX_TOKEN);
  // Numbered slots (scan a generous range)
  for (let i = 1; i <= 24; i++) {
    push(`MINIMAX_API_KEY_${i}`, env[`MINIMAX_API_KEY_${i}`]);
    push(`MINIMAX_TOKEN_${i}`, env[`MINIMAX_TOKEN_${i}`]);
  }
  // CSV bundles
  for (const [bundleName, raw] of [['MINIMAX_API_KEYS', env.MINIMAX_API_KEYS], ['MINIMAX_TOKENS', env.MINIMAX_TOKENS]]) {
    if (!raw) continue;
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((k, idx) => push(`${bundleName}[${idx}]`, k));
  }
  return slots;
}

/**
 * validateKeys() — tiny health-check per key against MiniMax-M2.7.
 * A key is usable iff HTTP 200 AND base_resp.status_code is 0/absent.
 * Returns { slotsDetected, usableCount, usable: [{slot,key,maskedKey}], report }.
 */
export async function validateKeys({ model = EVAL_MODEL, timeoutMs = 30000 } = {}) {
  const slots = loadMiniMaxKeys();
  const usable = [];
  const report = [];
  for (const s of slots) {
    const r = await healthCheck(s.key, { model, timeoutMs });
    report.push({ slot: s.slot, maskedKey: maskKey(s.key), ok: r.ok, httpStatus: r.httpStatus, baseStatus: r.baseStatus, latencyMs: r.latencyMs, reason: r.reason });
    if (r.ok) usable.push({ slot: s.slot, key: s.key, maskedKey: maskKey(s.key) });
    console.log(`[minimax-keypool] ${s.slot} ${maskKey(s.key)} → ${r.ok ? 'USABLE' : 'UNUSABLE'} (http ${r.httpStatus}${r.baseStatus != null ? `, base ${r.baseStatus}` : ''}${r.latencyMs ? `, ${r.latencyMs}ms` : ''})${r.reason ? ' · ' + r.reason : ''}`);
  }
  return { slotsDetected: slots.length, usableCount: usable.length, usable, report };
}

async function healthCheck(key, { model, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(MINIMAX_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly: MINIMAX_OK' }], max_tokens: 512, temperature: 0.1, stream: false, thinking: { type: 'disabled' } }),
      signal: ac.signal,
    });
    const latencyMs = Date.now() - t0;
    let data = null;
    try { data = await res.json(); } catch { /* non-json */ }
    const baseStatus = data?.base_resp?.status_code;
    const ok = res.status === 200 && (baseStatus == null || baseStatus === 0);
    let reason = null;
    if (!ok) {
      if (res.status === 401 || res.status === 403 || baseStatus === 1004) reason = 'auth_error';
      else if (res.status === 429 || baseStatus === 1002 || baseStatus === 1039) reason = 'rate_limited';
      else if (baseStatus === 1008) reason = 'out_of_credits';
      else reason = `http_${res.status}${baseStatus != null ? `_base_${baseStatus}` : ''}`;
    }
    return { ok, httpStatus: res.status, baseStatus, latencyMs, reason };
  } catch (e) {
    return { ok: false, httpStatus: 0, baseStatus: null, latencyMs: Date.now() - t0, reason: e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

// CLI: node minimax-keypool.mjs  → validate + write a masked usage file.
if (import.meta.url === `file://${process.argv[1]}`) {
  const v = await validateKeys({});
  const OUT = path.join(REPO_ROOT, 'test-results', 'intelligence-e2e-7000-minimax');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'minimax-key-usage.json'), JSON.stringify({ when: 'validation', model: EVAL_MODEL, slotsDetected: v.slotsDetected, usableCount: v.usableCount, report: v.report }, null, 2));
  console.log(`\n[minimax-keypool] ${v.slotsDetected} detected · ${v.usableCount} usable · wrote masked report.`);
  process.exit(v.usableCount ? 0 : 3);
}
