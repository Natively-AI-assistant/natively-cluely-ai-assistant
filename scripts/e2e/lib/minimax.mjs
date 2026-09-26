// scripts/e2e/lib/minimax.mjs
// Thin MiniMax-M3 client for fixture generation. Routes through the LOCAL
// natively-api /v1/chat (same MiniMax path the app uses) so generation is the
// real backend. Falls back to a direct MiniMax call only if the local server is
// down. The API key is read from natively-api/.env and NEVER printed/returned.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const LOCAL_URL = process.env.NATIVELY_API_URL || 'http://localhost:3000';
const LOCAL_TOKEN = process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || 'local-test-e2e-token';

function readKey() {
  const envTxt = fs.readFileSync(path.join(repoRoot, 'natively-api/.env'), 'utf8');
  const m = envTxt.match(/^MINIMAX_API_KEY=(.+)$/m);
  if (!m) throw new Error('MINIMAX_API_KEY not found in natively-api/.env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/** Non-streaming chat via the local backend (MiniMax-M3 forced). Returns text. */
export async function chat(system, user, { timeoutMs = 120000 } = {}) {
  try {
    const res = await fetch(`${LOCAL_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-natively-local-test': LOCAL_TOKEN },
      body: JSON.stringify({ system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.content) return String(data.content);
    }
    // fall through to direct on non-2xx
  } catch { /* fall through to direct */ }
  // Direct MiniMax fallback (still real MiniMax-M3).
  const prov = await import(pathToFileURL(path.join(repoRoot, 'natively-api/lib/minimaxProvider.js')).href);
  const key = readKey();
  const body = prov.buildMiniMaxBody(prov.MINIMAX_M3_MODEL, [{ role: 'user', content: user }], system, null, { stream: false });
  const res = await fetch(prov.MINIMAX_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`);
  const data = await res.json();
  const p = prov.parseMiniMaxResponse(data);
  if (!p.ok) throw new Error(`MiniMax soft error: ${p.reason}`);
  return prov.stripLeadingThink(p.text).trim();
}

/** Chat that must return JSON; extracts the first balanced {...} or [...]. Retries once. */
export async function chatJson(system, user, opts = {}) {
  const sys = `${system}\n\nRespond with ONLY valid JSON, no markdown fences, no prose.`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chat(sys, user, opts);
    const parsed = extractJson(raw);
    if (parsed !== null) return parsed;
  }
  throw new Error('chatJson: no parseable JSON after 3 attempts');
}

export function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Try whole string first.
  try { return JSON.parse(s); } catch { /* continue */ }
  // Find first balanced object/array.
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = s.indexOf(open);
    if (start === -1) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { break; } } }
    }
  }
  return null;
}
