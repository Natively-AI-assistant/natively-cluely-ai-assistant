/**
 * groq-keypool.mjs — safe Groq key loader, validator, and rotation scheduler.
 *
 * SECURITY: never prints, logs, or persists a raw key. All external output is the
 * masked form `gsk_****<last4>` and a stable slot name (GROQ_API_KEY_3). Raw keys
 * live only in-process in the pool array.
 *
 * Loads numbered keys (GROQ_API_KEY, GROQ_API_KEY_N) and the comma-list
 * GROQ_API_KEYS from .env, validates each against the REQUIRED eval model with a
 * tiny request, and exposes a round-robin scheduler with per-key cooldown,
 * 429/5xx backoff, and usage accounting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export const EVAL_MODEL = process.env.GROQ_EVAL_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
export const GROQ_BASE = 'https://api.groq.com/openai/v1';

export function maskKey(key) {
  if (!key || typeof key !== 'string') return '<none>';
  const last4 = key.slice(-4);
  return `gsk_****${last4}`;
}

function parseEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

/** Collect distinct Groq keys with stable slot labels. Never returns raw keys to callers that log. */
export function loadGroqKeys() {
  const env = { ...parseEnvFile(path.join(REPO_ROOT, '.env')), ...process.env };
  const slots = [];
  const seen = new Set();
  const add = (slot, key) => {
    if (!key || typeof key !== 'string') return;
    const k = key.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    slots.push({ slot, key: k });
  };
  // Numbered + singular
  add('GROQ_API_KEY', env.GROQ_API_KEY);
  for (let i = 1; i <= 32; i++) add(`GROQ_API_KEY_${i}`, env[`GROQ_API_KEY_${i}`]);
  // Comma list
  if (env.GROQ_API_KEYS) {
    env.GROQ_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean).forEach((k, idx) => add(`GROQ_API_KEYS[${idx}]`, k));
  }
  return slots;
}

async function pingKey(key, model, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 }),
      signal: ac.signal,
    });
    const ms = Date.now() - started;
    if (res.ok) { await res.text().catch(() => {}); return { ok: true, status: 200, ms }; }
    let bodyHint = '';
    try { const j = await res.json(); bodyHint = (j?.error?.code || j?.error?.type || '').toString(); } catch {}
    return { ok: false, status: res.status, ms, hint: bodyHint };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, hint: String(e?.name || e?.message || 'err').slice(0, 40) };
  } finally { clearTimeout(t); }
}

/** Validate every key against the eval model. Returns masked report + usable raw pool. */
export async function validateKeys({ model = EVAL_MODEL } = {}) {
  const slots = loadGroqKeys();
  const report = [];
  const usable = [];
  for (const { slot, key } of slots) {
    const r = await pingKey(key, model);
    report.push({ slot, masked: maskKey(key), ok: r.ok, status: r.status, latencyMs: r.ms, hint: r.hint || null });
    if (r.ok) usable.push({ slot, key, masked: maskKey(key) });
    await new Promise((res) => setTimeout(res, 150));
  }
  return { model, slotsDetected: slots.length, usableCount: usable.length, report, usable };
}

/**
 * Round-robin key scheduler with per-key cooldown + adaptive backoff.
 * acquire() → { slot, key, masked }; on 429/5xx call penalize(slot).
 */
export class KeyScheduler {
  constructor(usable, { perKeyCooldownMs = 250 } = {}) {
    this.pool = usable.map((u) => ({ ...u, calls: 0, errors: 0, cooldownUntil: 0 }));
    this.perKeyCooldownMs = perKeyCooldownMs;
    this.rr = 0;
    if (!this.pool.length) throw new Error('KeyScheduler: no usable Groq keys');
  }
  size() { return this.pool.length; }
  async acquire() {
    for (let attempt = 0; attempt < this.pool.length * 4; attempt++) {
      const cand = this.pool[this.rr % this.pool.length];
      this.rr++;
      const now = Date.now();
      if (cand.cooldownUntil <= now) { cand.calls++; cand.lastUsed = now; return cand; }
      const minWait = Math.min(...this.pool.map((p) => Math.max(0, p.cooldownUntil - now)));
      if (minWait > 0 && attempt >= this.pool.length) await new Promise((r) => setTimeout(r, Math.min(minWait, 2000)));
    }
    const cand = this.pool[this.rr % this.pool.length];
    cand.calls++;
    return cand;
  }
  release(slot) {
    const p = this.pool.find((x) => x.slot === slot);
    if (p) p.cooldownUntil = Date.now() + this.perKeyCooldownMs;
  }
  penalize(slot, ms = 5000) {
    const p = this.pool.find((x) => x.slot === slot);
    if (p) { p.errors++; p.cooldownUntil = Date.now() + ms; }
  }
  usage() {
    return this.pool.map((p) => ({ slot: p.slot, masked: p.masked, calls: p.calls, errors: p.errors }));
  }
}

// CLI: `node groq-keypool.mjs` → validate + write report (masked).
if (import.meta.url === `file://${process.argv[1]}`) {
  validateKeys().then((v) => {
    const outDir = path.join(REPO_ROOT, 'test-results', 'intelligence-e2e');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'groq-key-usage.json'), JSON.stringify({ phase: 'validation', ...v, usable: undefined }, null, 2));
    console.log(`[groq-keypool] model=${v.model}`);
    console.log(`[groq-keypool] slots detected: ${v.slotsDetected} · usable: ${v.usableCount}`);
    for (const r of v.report) console.log(`  ${r.slot.padEnd(18)} ${r.masked}  ${r.ok ? 'OK' : 'FAIL'} status=${r.status} ${r.latencyMs}ms ${r.hint ? '(' + r.hint + ')' : ''}`);
    process.exit(v.usableCount > 0 ? 0 : 3);
  }).catch((e) => { console.error('[groq-keypool] fatal:', e.message); process.exit(1); });
}
