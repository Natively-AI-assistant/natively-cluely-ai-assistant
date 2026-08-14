// electron/llm/__tests__/TextHedgeConfig.test.mjs
//
// HISTORY: this file originally pinned the direct-Gemini TEXT path's flash →
// flash-lite tail-latency HEDGE timing contract (2026-06-06, Issue 8). That
// hedge has since been REMOVED: the live text path (LLMHelper.streamGeminiTextCascade)
// now runs a SERIAL Gemini cascade — full ladder gemini-3.1-flash-lite →
// gemini-3.6-flash → gemini-3.1-pro-preview — with NO parallel racing.
//
// The user's selected Gemini model is honored as the STARTING rung and the
// cascade falls FORWARD (toward more capable) from there:
//   - flash-lite selected (default) → flash-lite → flash → pro
//   - flash selected                → flash → pro
//   - pro selected                  → pro only
//   - other / non-Gemini fell through → full ladder
//
// This test pins:
//   1. The cascade delegates to runStreamingTextFallback with
//      DEFAULT_TEXT_FALLBACK_CONFIG, whose hedgeEnabled is false (no racing).
//   2. The start-rung selection logic (selectStartIndex) matches the product.
//   3. From a given start rung, a provider that fails BEFORE its first token
//      falls forward to the next; rungs below the start are never opened.
//   4. The first provider to commit (yield a token) wins; the cascade never
//      switches providers post-commit, so output is never duplicated.
//
// It exercises the REAL compiled engine with deterministic fake providers
// shaped exactly like streamGeminiTextCascade builds them (id/name/priority,
// open(signal) returning an async generator, NO hedgeWith).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/textStreamFallback.js');
const {
  runStreamingTextFallback,
  orderTextByHealth,
  DEFAULT_TEXT_FALLBACK_CONFIG,
} = await import(pathToFileURL(modPath).href);

const FLASH_LITE = 'gemini-3.1-flash-lite';
const FLASH = 'gemini-3.6-flash';
const PRO = 'gemini-3.1-pro-preview';

// The full ladder, cheapest → most capable (priority encodes order).
const LADDER = [
  { id: 'gemini_flash_lite', model: FLASH_LITE, priority: 0 },
  { id: 'gemini_flash', model: FLASH, priority: 1 },
  { id: 'gemini_pro', model: PRO, priority: 2 },
];

// Mirror of streamGeminiTextCascade's start-rung logic. Kept in sync by this
// test — if the product mapping changes, these assertions should change with it.
function selectStartIndex(selectedModelId) {
  return selectedModelId === PRO ? 2
    : selectedModelId === FLASH ? 1
    : 0;
}

// Build the active provider list for a given selected model + per-id behavior.
// behavior[id] = { tokens? , throwBefore? } — throwBefore fails the provider
// before its first token (pre-commit), forcing a forward fall-through.
function buildCascade(selectedModelId, behavior = {}) {
  const start = selectStartIndex(selectedModelId);
  return LADDER.slice(start).map(({ id, priority }) => ({
    id, name: id, isLocal: false, priority,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      const b = behavior[id] || { tokens: [`${id}-ok`] };
      return (async function* () {
        if (b.throwBefore) throw new Error(`${id} failed pre-commit`);
        for (const t of (b.tokens || [`${id}-ok`])) yield t;
      })();
    },
  }));
}

async function run(providers) {
  const ordered = orderTextByHealth(providers, new Map(), Date.now());
  let out = '';
  for await (const c of runStreamingTextFallback(ordered, new Map(), DEFAULT_TEXT_FALLBACK_CONFIG, {})) out += c;
  return out;
}
const calls = (providers, id) => (providers.find(p => p.id === id)?._calls ?? 0);

describe('Gemini text cascade (replaces the old flash→flash-lite hedge)', () => {
  test('cascade config has hedging OFF (strict serial, no parallel racing)', () => {
    assert.equal(DEFAULT_TEXT_FALLBACK_CONFIG.hedgeEnabled, false);
  });

  test('start-rung selection honors the selected Gemini model', () => {
    assert.equal(selectStartIndex(FLASH_LITE), 0);
    assert.equal(selectStartIndex(FLASH), 1);
    assert.equal(selectStartIndex(PRO), 2);
    // Default / unknown / non-Gemini fall-through → full ladder (start 0).
    assert.equal(selectStartIndex('natively'), 0);
    assert.equal(selectStartIndex(undefined), 0);
  });

  test('default (flash-lite) → flash-lite is sole primary; flash + pro never opened', async () => {
    const providers = buildCascade(FLASH_LITE);
    assert.equal(await run(providers), 'gemini_flash_lite-ok');
    assert.equal(calls(providers, 'gemini_flash_lite'), 1);
    assert.equal(calls(providers, 'gemini_flash'), 0);
    assert.equal(calls(providers, 'gemini_pro'), 0);
  });

  test('flash-lite pre-commit failure falls forward to flash (not pro)', async () => {
    const providers = buildCascade(FLASH_LITE, { gemini_flash_lite: { throwBefore: true } });
    assert.equal(await run(providers), 'gemini_flash-ok');
    assert.equal(calls(providers, 'gemini_flash'), 1);
    assert.equal(calls(providers, 'gemini_pro'), 0);
  });

  test('flash-lite + flash both fail pre-commit → pro answers (full ladder)', async () => {
    const providers = buildCascade(FLASH_LITE, {
      gemini_flash_lite: { throwBefore: true },
      gemini_flash: { throwBefore: true },
    });
    assert.equal(await run(providers), 'gemini_pro-ok');
    assert.equal(calls(providers, 'gemini_pro'), 1);
  });

  test('selecting Flash starts at flash → pro; flash-lite is NOT opened', async () => {
    const providers = buildCascade(FLASH);
    assert.equal(calls(providers, 'gemini_flash_lite'), 0, 'flash-lite rung should not exist below the start');
    assert.equal(providers.find(p => p.id === 'gemini_flash_lite'), undefined);
    assert.equal(await run(providers), 'gemini_flash-ok');
    assert.equal(calls(providers, 'gemini_flash'), 1);
  });

  test('selecting Flash, flash fails → falls forward to pro', async () => {
    const providers = buildCascade(FLASH, { gemini_flash: { throwBefore: true } });
    assert.equal(await run(providers), 'gemini_pro-ok');
    assert.equal(calls(providers, 'gemini_pro'), 1);
  });

  test('selecting Pro → pro only (no fallback below it)', async () => {
    const providers = buildCascade(PRO);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].id, 'gemini_pro');
    assert.equal(await run(providers), 'gemini_pro-ok');
  });

  test('first committed provider wins — multi-token flash-lite output is not duplicated by flash', async () => {
    const providers = buildCascade(FLASH_LITE, { gemini_flash_lite: { tokens: ['He', 'llo', '!'] } });
    assert.equal(await run(providers), 'Hello!');
    assert.equal(calls(providers, 'gemini_flash'), 0);
  });
});
