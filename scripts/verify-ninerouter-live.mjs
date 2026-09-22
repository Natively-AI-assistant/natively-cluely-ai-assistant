/**
 * The verification that needed a key: a real answer through the real code.
 *
 * The key is read from the local instance at runtime and never printed.
 */
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/ninerouter-provider';
const BASE = 'http://localhost:20128/v1';

const electronPath = require.resolve(path.join(ROOT, 'node_modules/electron'));
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(path.join(ROOT, 'dist-electron/electron/LLMHelper.js'));
const { probeNinerouter } = require(path.join(ROOT, 'dist-electron/electron/llm/ninerouterProbe.js'));

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
};

const keys = await (await fetch('http://localhost:20128/api/keys')).json();
const KEY = keys.keys?.[0]?.key;
if (!KEY) { console.log('no key available'); process.exit(1); }
console.log(`using key ...${KEY.slice(-6)} (name: ${keys.keys[0].name})\n`);

// ── 1. the probe's never-observed success branch ────────────────────────────
const good = await probeNinerouter(BASE, KEY, { timeoutMs: 10000 });
check('probe with a REAL key reports ok (the branch a keyless instance can never show)',
  good.ok === true, JSON.stringify(good));

const bad = await probeNinerouter(BASE, 'sk-definitely-wrong', { timeoutMs: 10000 });
check('probe with a WRONG key still reports auth',
  bad.ok === false && bad.reason === 'auth', JSON.stringify({ ok: bad.ok, reason: bad.reason, status: bad.status }));

// ── 2. a real streaming answer through streamWithNinerouter ─────────────────
const MODEL = process.env.NR_MODEL || 'gemini/gemini-3.5-flash-lite';
const h = Object.create(LLMHelper.prototype);
h.isLocalOnlyMode = false;
h.assertOutboundScopes = () => {};
h.rateLimiters = { ninerouter: { acquire: async () => {} } };
h.currentModelId = `ninerouter/${MODEL}`;
h.ninerouterApiKey = KEY;
h.ninerouterBaseURL = BASE;
h.ninerouterMaxTokens = null;
h.ninerouterModelBudgets = new Map();
h.ninerouterModelInputCaps = new Map();
h.ninerouterModelsFetchedAt = 0;
h.ninerouterModelsFetch = null;
const { default: OpenAI } = await import(path.join(ROOT, 'node_modules/openai/index.mjs'));
h._ninerouterClient = new OpenAI({ apiKey: KEY, baseURL: BASE });
h.isProviderDisabled = () => false;

// The budget path, which reads the live catalogue.
const budget = await LLMHelper.prototype.resolveNinerouterMaxTokens.call(h, MODEL);
check('resolveNinerouterMaxTokens reads a real budget from /v1/models',
  Number.isFinite(budget) && budget > 0,
  `max_tokens=${budget}, catalogue cached ${h.ninerouterModelBudgets.size} budgets / ${h.ninerouterModelInputCaps.size} context windows`);

let text = '';
let chunks = 0;
const t0 = Date.now();
try {
  for await (const piece of LLMHelper.prototype.streamWithNinerouter.call(
    h, 'Reply with exactly the word: ok', 'You are terse.', undefined, undefined, `ninerouter/${MODEL}`)) {
    text += piece; chunks++;
  }
} catch (e) {
  check('streamWithNinerouter produced a streamed answer', false, `THREW: ${e.message}`);
}
if (chunks > 0 || text) {
  check('streamWithNinerouter produced a streamed answer',
    text.trim().length > 0,
    `${chunks} SSE chunk(s) in ${Date.now() - t0}ms -> ${JSON.stringify(text.slice(0, 80))}`);
}

// ── 3. the open question: what does the response report as `model`? ─────────
const raw = await fetch(`${BASE}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'say ok' }], max_tokens: 5, stream: false }),
});
const body = await raw.json();
console.log(`\nATTRIBUTION: requested ${JSON.stringify(MODEL)} -> response.model ${JSON.stringify(body?.model)}`);
console.log(`             ${body?.model === MODEL ? 'REPORTS THE REQUESTED ID' : 'REPORTS A DIFFERENT (SERVED) ID'}`);

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
