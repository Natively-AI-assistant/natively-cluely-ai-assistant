/** Phase 4 live: does Direct Assist actually answer through 9Router? */
import os from 'node:os';
import path from 'node:path';
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

const results = [];
const check = (n, pass, d = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? '\n        ' + d : ''}`); };

const KEY = (await (await fetch('http://localhost:20128/api/keys')).json()).keys[0].key;
const MODEL = process.env.NR_MODEL || 'gemini/gemini-3.5-flash-lite';
const PREFIXED = `ninerouter/${MODEL}`;

const { default: OpenAI } = await import(path.join(ROOT, 'node_modules/openai/index.mjs'));

const h = Object.create(LLMHelper.prototype);
h.currentModelId = PREFIXED;
h.useOllama = false;
h.customProvider = null;
h.activeCurlProvider = null;
h.isLocalOnlyMode = false;
h.ollamaVisionCache = new Map();
h.isProviderDisabled = () => false;
h.assertOutboundScopes = () => {};
h.rateLimiters = { ninerouter: { acquire: async () => {} } };
h.ninerouterApiKey = KEY;
h.ninerouterBaseURL = BASE;
h.ninerouterMaxTokens = null;
h.ninerouterModelBudgets = new Map();
h.ninerouterModelInputCaps = new Map();
h.ninerouterVisionModels = new Set();
h.ninerouterModelsFetchedAt = 0;
h.ninerouterModelsFetch = null;
h._ninerouterClient = new OpenAI({ apiKey: KEY, baseURL: BASE });

// 1. classification against the REAL selected model
const sel = LLMHelper.prototype.getDirectAssistSelection.call(h);
check('the live selection classifies as ninerouter',
  sel.provider === 'ninerouter' && sel.model === PREFIXED, JSON.stringify(sel));

// 2. configured
check('directProviderHasCredential sees the client',
  LLMHelper.prototype.directProviderHasCredential.call(h, 'ninerouter') === true);

// 3. a REAL answer through the Direct Assist dispatch path
let out = '', threw = null;
const t0 = Date.now();
try {
  const gen = LLMHelper.prototype.streamDirectAssistFrozen.call(
    h,
    { selection: sel, systemPrompt: 'You are terse.', userPrompt: 'Reply with exactly the word: ok', imagePaths: [] },
    null, null, undefined,
  );
  for await (const piece of gen) out += piece;
} catch (e) { threw = e; }
check('Direct Assist answers through 9Router',
  !threw && out.trim().length > 0,
  threw ? `THREW: ${threw.message}` : `${Date.now() - t0}ms -> ${JSON.stringify(out.trim().slice(0, 60))}`);

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
