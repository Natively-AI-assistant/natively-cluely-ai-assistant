#!/usr/bin/env node
/**
 * LIVE OpenCode test — real key, real network, real SDKs.
 *
 * Drives the SHIPPED adapters (`streamWithOpencode`, `generateWithOpencode`)
 * against `opencode.ai`. It does not mock a client, a stream or a header.
 *
 *   OPENCODE_KEY=... node scripts/opencode-live-test.mjs
 *
 * Cost control: every request is clamped to a small output ceiling (128 tokens
 * unless the model's own catalogue ceiling is lower), prompts are one line, and
 * only the cheapest model of each protocol family is used. The key is read from
 * the environment and is never printed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const KEY = (process.env.OPENCODE_KEY || '').trim();
if (!KEY) {
  console.error('OPENCODE_KEY is not set');
  process.exit(2);
}

// CredentialsManager (imported transitively) wants Electron's app paths.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-live' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));
const { fetchOpencodeCatalogue } = require(path.join(root, 'dist-electron/electron/utils/modelFetcher.js'));
const { probeOpencode } = require(path.join(root, 'dist-electron/electron/llm/opencode/probe.js'));

const OpenAI = require('openai');
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod?.default || AnthropicMod;
const sharp = require('sharp');

let failures = 0;
const results = [];
const ok = (name, cond, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`); results.push({ name, pass: true }); }
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); results.push({ name, pass: false, detail }); }
};

const PREFERENCE = {
  'chat-completions': ['deepseek-v4.1-flash', 'glm-5.3', 'glm-5', 'kimi-k3', 'minimax-m3', 'big-pickle'],
  // Go-routed ids lead: this key has a Go subscription and no pay-as-you-go
  // credits, so a paid id answers 402. The fallbacks keep the script useful for
  // a credit-funded key too.
  responses: ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-nano', 'gpt-5.4-nano', 'gpt-5.1', 'gpt-5.4'],
  messages: ['claude-haiku-5-5', 'qwen3.8-flash', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5'],
  'generate-content': ['gemini-4-argon', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'],
};

const isGo = (meta, id) => String(meta[id]?.baseUrl || '').includes('/go/');

const pick = (meta, family) => {
  const available = (id) => meta[id]?.api === family;
  // Prefer a model this key can actually call: Go first when Go serves it.
  const go = PREFERENCE[family].find((id) => available(id) && isGo(meta, id));
  if (go) return go;
  const preferred = PREFERENCE[family].find(available);
  if (preferred) return preferred;
  return Object.keys(meta).find((id) => available(id) && isGo(meta, id))
    || Object.keys(meta).find(available)
    || null;
};

function buildHelper(meta) {
  const h = Object.create(LLMHelper.prototype);
  h.isLocalOnlyMode = false;
  h.currentModelId = 'opencode/deepseek-v4.1-flash';
  h.textHealth = new Map();
  h.visionHealth = new Map();
  h.assertOutboundScopes = () => {};
  h.rateLimiters = { opencode: { acquire: async () => {} } };
  h.isProviderDisabled = () => false;
  // Clamp the output ceiling hard: a cap is not usage, but it stops a runaway
  // answer from spending more than a few cents on a smoke test.
  const clamped = Object.fromEntries(Object.entries(meta).map(([id, m]) => [
    id,
    { ...m, outputTokens: Math.min(m.outputTokens || 128, 128) },
  ]));
  // EXERCISE THE PRODUCTION SETTER: clients, Go session header, base cache.
  h.setOpencodeConfig(KEY, clamped);
  h.__usage = [];
  h.recordOpencodeUsage = (usage) => {
    if (usage) h.__usage.push({ cost: usage.cost, billing: usage.opencode?.billing_source });
  };
  return h;
}

async function drain(gen) {
  let text = '';
  let firstAt = 0;
  const start = Date.now();
  for await (const chunk of gen) {
    if (!firstAt) firstAt = Date.now();
    text += chunk;
  }
  return { text, ttftMs: firstAt ? firstAt - start : null, totalMs: Date.now() - start };
}

async function makeVisionFixture() {
  const dir = path.join(root, 'scratch-opencode-live');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'vision-fixture.png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="360">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="40" y="190" font-family="sans-serif" font-size="120" font-weight="700" fill="#111111">NATIVELY-4271</text>
    <circle cx="1290" cy="285" r="46" fill="#e11d48"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

(async () => {
  console.log('OpenCode LIVE test');
  console.log('key: oc_sk_… (not printed)\n');

  // ── 1. connection probe ─────────────────────────────────────────────────
  console.log('1. Connection probe');
  const probe = await probeOpencode(KEY, { timeoutMs: 15000 });
  console.log(`   probe: ok=${probe.ok} reason=${probe.reason || '-'} status=${probe.status ?? '-'}`);
  if (!probe.ok) console.log(`   detail: ${probe.error}`);
  ok('probeOpencode says the key works', probe.ok, probe.error);

  // ── 2. catalogue ────────────────────────────────────────────────────────
  console.log('\n2. Catalogue (workspace-scoped)');
  const catalogue = await fetchOpencodeCatalogue(KEY);
  const meta = catalogue.meta;
  const ids = Object.keys(meta);
  const byFamily = ids.reduce((a, id) => { a[meta[id].api] = (a[meta[id].api] || 0) + 1; return a; }, {});
  const visionIds = ids.filter((id) => meta[id].vision);
  console.log(`   ${ids.length} usable models; families ${JSON.stringify(byFamily)}`);
  console.log(`   vision-capable ${visionIds.length}; free ids withheld ${catalogue.freeSkipped}`);
  ok('the key scopes a non-empty catalogue', ids.length > 0);
  ok('every family this key can reach has a candidate',
    Object.keys(PREFERENCE).every((f) => !!pick(meta, f)),
    JSON.stringify(Object.fromEntries(Object.keys(PREFERENCE).map((f) => [f, pick(meta, f)]))));

  const helper = buildHelper(meta);

  // ── 3. streaming chat, one model per protocol ───────────────────────────
  console.log('\n3. Streaming chat through each protocol adapter');
  const deepseekBase = meta['deepseek-v4.1-flash']?.baseUrl || '';
  console.log(`   deepseek-v4.1-flash base: ${deepseekBase}`);
  console.log(`   go-routed models: ${ids.filter((id) => meta[id].baseUrl.includes('/go/')).length}/${ids.length}`);
  const cases = [
    ['chat-completions', 'deepseek-v4.1-flash'], // the model requested for this test
    ['responses', null],
    ['messages', null],
    ['generate-content', null],
  ];
  for (const [family, forced] of cases) {
    const model = forced && meta[forced]?.api === family ? forced : pick(meta, family);
    if (!model) { ok(`${family} has an available model`, false); continue; }
    const routed = `opencode/${model}`;
    try {
      const r = await drain(helper.streamWithOpencode(
        'Reply with exactly the word: PONG', undefined, undefined, undefined, routed,
      ));
      console.log(`   ${family.padEnd(17)} ${model.padEnd(24)} base=${meta[model].baseUrl.replace('https://opencode.ai', '')} ttft=${r.ttftMs ?? '-'}ms total=${r.totalMs}ms text=${JSON.stringify(r.text.slice(0, 60))}`);
      ok(`${family} answered with text`, r.text.trim().length > 0, JSON.stringify(r.text));
      ok(`${family} produced a first token`, r.ttftMs !== null);
    } catch (e) {
      console.error(`   ${family} ERROR: ${e?.message}`);
      ok(`${family} stream completes`, false, e?.message);
    }
  }

  // ── 4. blocking "get answer" path ───────────────────────────────────────
  console.log('\n4. Blocking answer (generateWithOpencode: notes/extraction path)');
  const answerModel = pick(meta, 'chat-completions');
  if (answerModel) {
    try {
      const start = Date.now();
      const text = await helper.generateWithOpencode(
        'What is 17*23? Reply with just the number.',
        'You answer arithmetic with a bare number.',
      );
      const ms = Date.now() - start;
      console.log(`   ${answerModel}: ${JSON.stringify(text.trim().slice(0, 80))} in ${ms}ms`);
      ok('the blocking path returns an answer', text.trim().length > 0);
      ok('the arithmetic answer is correct (391)', /\b391\b/.test(text));
    } catch (e) {
      console.error(`   ERROR: ${e?.message}`);
      ok('the blocking path completes', false, e?.message);
    }
  }

  // ── 5. real image understanding ─────────────────────────────────────────
  console.log('\n5. Read a photo (real PNG, real vision models)');
  const visionModel = meta['deepseek-v4.1-flash']?.vision
    ? 'deepseek-v4.1-flash'
    : visionIds[0];

  if (!visionModel) {
    ok('a vision-capable model is available', false);
  } else {
    const fixture = await makeVisionFixture();
    console.log(`   fixture: ${fixture} (1400x360, text "NATIVELY-4271", red circle)`);
    ok('the vision gate seats deepseek-v4.1-flash', helper.opencodeModelSupportsVision('opencode/deepseek-v4.1-flash') === true);
    const textOnly = ids.find((id) => meta[id].vision === false);
    if (textOnly) {
      ok('the vision gate refuses a catalogue text-only model',
        helper.opencodeModelSupportsVision(`opencode/${textOnly}`) === false, textOnly);
    }

    // Two families, so the image path is proven in more than one protocol.
    const visionCases = [visionModel, pick(meta, 'generate-content')].filter(Boolean);
    for (const model of [...new Set(visionCases)]) {
      const base = (meta[model].baseUrl || '').replace('https://opencode.ai', '');
      console.log(`   model: ${model} (${meta[model].api}, ${base})`);
      try {
        const r = await drain(helper.streamWithOpencode(
          'Read the large text in this image. Reply with exactly that text and nothing else.',
          'You read text from images verbatim.',
          [fixture],
          undefined,
          `opencode/${model}`,
        ));
        console.log(`   ttft=${r.ttftMs ?? '-'}ms total=${r.totalMs}ms`);
        console.log(`   answer: ${JSON.stringify(r.text.trim().slice(0, 200))}`);
        ok(`${model} read the fixture text`, /NATIVELY[\s\-_:]*4271/i.test(r.text), r.text.slice(0, 200));
      } catch (e) {
        console.error(`   ERROR: ${e?.message}`);
        ok(`${model} vision request completes`, false, e?.message);
      }
    }
  }

  // ── 6. cost reporting ───────────────────────────────────────────────────
  console.log('\n6. Usage / cost reported by OpenCode');
  const usage = helper.__usage.filter(Boolean);
  console.log(`   usage events: ${JSON.stringify(usage).slice(0, 400)}`);
  ok('at least one response reported usage or cost', usage.length > 0);

  fs.rmSync(path.join(root, 'scratch-opencode-live'), { recursive: true, force: true });

  console.log(`\nLIVE TEST: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nLive test crashed:', e?.stack || e?.message || e);
  process.exit(1);
});
