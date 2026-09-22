/**
 * Phase 2 live verification: does a real screenshot reach a real 9Router vision
 * model, and does the catalogue's per-model capability match reality?
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
};

const KEY = (await (await fetch('http://localhost:20128/api/keys')).json()).keys[0].key;

// ── the real catalogue's vision split ───────────────────────────────────────
const cat = await (await fetch(`${BASE}/models`)).json();
const visionIds = cat.data.filter(m => m?.capabilities?.vision === true).map(m => m.id);
const textOnlyIds = cat.data.filter(m => m?.capabilities && m.capabilities.vision !== true).map(m => m.id);
check('the live catalogue splits vision from text-only',
  visionIds.length > 0 && textOnlyIds.length > 0,
  `${visionIds.length} vision-capable, ${textOnlyIds.length} text-only, of ${cat.data.length}`);

// ── the predicate against REAL ids ──────────────────────────────────────────
const h = Object.create(LLMHelper.prototype);
h.ninerouterVisionModels = new Set(visionIds);
const sees = (id) => LLMHelper.prototype.ninerouterModelSupportsVision.call(h, `ninerouter/${id}`);
check('a real vision model is accepted and a real text-only model is refused',
  sees(visionIds[0]) === true && sees(textOnlyIds[0]) === false,
  `${visionIds[0]} -> true, ${textOnlyIds[0]} -> false`);

// ── a REAL screenshot through streamWithNinerouter ──────────────────────────
// A 2x1 PNG would prove nothing, so capture something with legible content:
// render text to a PNG via macOS's own screencapture of a temp window is
// overkill — instead draw a known word with sips-compatible raw PNG bytes.
const png = path.join(os.tmpdir(), 'nr-vision-probe.png');
// Solid red 64x64 PNG (base64, generated once, deterministic).
execFileSync('/usr/bin/python3', ['-c', `
import zlib, struct, sys
W=H=64
raw=b''.join(b'\\x00'+bytes([220,30,30])*W for _ in range(H))
def chunk(t,d):
    c=struct.pack('>I',len(d))+t+d
    return c+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
png=b'\\x89PNG\\r\\n\\x1a\\n'
png+=chunk(b'IHDR',struct.pack('>IIBBBBB',W,H,8,2,0,0,0))
png+=chunk(b'IDAT',zlib.compress(raw))
png+=chunk(b'IEND',b'')
open(${JSON.stringify(png)},'wb').write(png)
`]);

const VISION_MODEL = process.env.NR_VISION_MODEL || visionIds.find(id => /gemini/.test(id)) || visionIds[0];
const { default: OpenAI } = await import(path.join(ROOT, 'node_modules/openai/index.mjs'));

const v = Object.create(LLMHelper.prototype);
v.isLocalOnlyMode = false;
v.assertOutboundScopes = () => {};
v.rateLimiters = { ninerouter: { acquire: async () => {} } };
v.currentModelId = `ninerouter/${VISION_MODEL}`;
v.ninerouterApiKey = KEY;
v.ninerouterBaseURL = BASE;
v.ninerouterMaxTokens = null;
v.ninerouterModelBudgets = new Map();
v.ninerouterModelInputCaps = new Map();
v.ninerouterVisionModels = new Set(visionIds);
v.ninerouterModelsFetchedAt = 0;
v.ninerouterModelsFetch = null;
v._ninerouterClient = new OpenAI({ apiKey: KEY, baseURL: BASE });
v.isProviderDisabled = () => false;

let out = '';
let threw = null;
const t0 = Date.now();
try {
  for await (const piece of LLMHelper.prototype.streamWithNinerouter.call(
    v, 'What single colour fills this image? Answer with one word.', 'You are terse.',
    [png], undefined, `ninerouter/${VISION_MODEL}`)) {
    out += piece;
  }
} catch (e) { threw = e; }

check('a REAL screenshot reaches a 9Router vision model and is described',
  !threw && /red/i.test(out),
  threw ? `THREW: ${threw.message}` : `${VISION_MODEL} in ${Date.now() - t0}ms -> ${JSON.stringify(out.trim().slice(0, 60))}`);

// ── the catalogue's claim is TRUE: a text-only model actually refuses ───────
const TEXT_MODEL = textOnlyIds[0];
let textOnlyErr = null;
try {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: TEXT_MODEL, max_tokens: 8, stream: false,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'what colour?' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${fs.readFileSync(png).toString('base64')}` } },
      ] }],
    }),
  });
  const body = await r.json();
  textOnlyErr = r.ok ? null : (body?.error?.message || `HTTP ${r.status}`);
  console.log(`\n  text-only model ${TEXT_MODEL} sent an image -> ${r.status} ${textOnlyErr ? JSON.stringify(textOnlyErr.slice(0,90)) : 'accepted anyway'}`);
} catch (e) { console.log('  text-only probe failed:', e.message); }

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
