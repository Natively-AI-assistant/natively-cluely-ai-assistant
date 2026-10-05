// Privacy panel indicator parity (2026-08-01).
//
// Settings > AI Providers > Privacy told the user where a DENIED data scope's
// content actually goes ("On-device" vs "Omitted"), and whether the local-only
// screenshot switch would work. It answered both with `ollamaModels.length > 0`.
//
// Enforcement asks a strictly different question. Every scope-denial site gates
// on `this.useOllama && this.checkOllamaAvailable(needsVision)`:
//   - `useOllama`   — Ollama must be the SELECTED provider, not merely installed.
//   - `needsVision` — true only for screenshots, so a text-only install IS a
//                     real fallback for Transcripts but NOT for Screenshots.
//
// `ollamaModels.length > 0` captures neither term, so the indicator could claim
// on-device handling for content that was about to be dropped, and suppress its
// own "no local vision model" warning. `scopeFallbackAvailable()` exists so the
// indicator and the gate share ONE predicate.
//
// These tests assert on the PREDICATE THE GATE USES, driving the real LLMHelper
// method rather than a reimplementation of it.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// `electron` is an esbuild external; LLMHelper's dependencies touch `app` at
// module/constructor scope. Without this shim the live readers fail open and
// every assertion below would be vacuous.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));

// checkOllamaAvailable ends with a real POST to `${ollamaUrl}/api/show`. Without
// a stub every case returns false and the whole file passes vacuously.
const realFetch = globalThis.fetch;
function stubDaemon({ up = true } = {}) {
  globalThis.fetch = async () => {
    if (!up) throw new Error('ECONNREFUSED');
    return { ok: true };
  };
}
function restoreDaemon() { globalThis.fetch = realFetch; }

/** A helper with a controlled Ollama inventory and selection state. */
function helperWith({ selected, models }) {
  // NOTE: checkOllamaAvailable tests the capability of the SELECTED model
  // (this.ollamaModel), not of any installed model — one more reason the
  // renderer must not re-derive this.
  const h = new LLMHelper(undefined, selected, models[0], 'http://127.0.0.1:11434');
  h.getOllamaModels = async () => models;
  return h;
}

const VISION_MODEL = 'llava:7b';
const TEXT_MODEL = 'nomic-embed-text';

describe('privacy indicator shares the enforcement predicate', () => {
  beforeEach(() => stubDaemon({ up: true }));
  afterEach(() => restoreDaemon());

  test('baseline: the stubbed daemon really does allow a positive result', async () => {
    // Guards every negative assertion below from passing for the wrong reason.
    const h = helperWith({ selected: true, models: [VISION_MODEL] });
    assert.equal(await h.scopeFallbackAvailable(true), true);
  });

  test('a text-only install is NOT a screenshot fallback (the reported drift)', async () => {
    const h = helperWith({ selected: true, models: [TEXT_MODEL, 'llama3'] });
    // The old UI predicate — `ollamaModels.length > 0` — is true here, which is
    // exactly why the "no local vision model" warning was suppressed.
    assert.equal([TEXT_MODEL, 'llama3'].length > 0, true, 'precondition: old predicate says yes');
    assert.equal(
      await h.scopeFallbackAvailable(true), false,
      'LEAK OF TRUST: the panel would show "On-device" for screenshots that are about to be dropped',
    );
  });

  test('a text-only install IS a fallback for non-vision scopes', async () => {
    const h = helperWith({ selected: true, models: [TEXT_MODEL, 'llama3'] });
    assert.equal(
      await h.scopeFallbackAvailable(false), true,
      'a single shared boolean would wrongly mark Transcripts "Omitted" here',
    );
  });

  test('installed-but-not-selected is NOT a fallback (the second missing term)', async () => {
    const h = helperWith({ selected: false, models: [VISION_MODEL] });
    assert.equal(
      await h.scopeFallbackAvailable(true), false,
      'the gate requires Ollama to be the SELECTED provider; the panel must not promise otherwise',
    );
    assert.equal(await h.scopeFallbackAvailable(false), false);
  });

  test('selected + vision-capable is a fallback for both', async () => {
    const h = helperWith({ selected: true, models: [VISION_MODEL] });
    assert.equal(await h.scopeFallbackAvailable(true), true);
    assert.equal(await h.scopeFallbackAvailable(false), true);
  });

  test('the two predicates genuinely differ — the split is not decorative', async () => {
    const h = helperWith({ selected: true, models: [TEXT_MODEL] });
    const vision = await h.scopeFallbackAvailable(true);
    const text = await h.scopeFallbackAvailable(false);
    assert.notEqual(
      vision, text,
      'if these can never disagree, one shared boolean would have been correct and this fix is pointless',
    );
  });

  test('an unreachable daemon fails CLOSED, never claiming on-device', async () => {
    stubDaemon({ up: false });
    const h = helperWith({ selected: true, models: [VISION_MODEL] });
    assert.equal(await h.scopeFallbackAvailable(true), false);
    assert.equal(await h.scopeFallbackAvailable(false), false);
  });

  // The purity split (probeOllama / ensureOllamaModelSelected) changed exactly
  // this case: checkOllamaAvailable used to REPAIR a missing or stale
  // this.ollamaModel in place; the pure probe now resolves an effective model
  // without writing it. If those two resolutions ever disagree, the badge and
  // the gate diverge and the original over-promising bug is back.
  test('an UNSET selected model still resolves — badge matches gate', async () => {
    const h = helperWith({ selected: true, models: [VISION_MODEL] });
    h.ollamaModel = undefined;
    assert.equal(await h.scopeFallbackAvailable(true), true);
    assert.equal(await h.scopeFallbackAvailable(false), true);
  });

  test('a STALE selected model resolves against the installed list, not the stale name', async () => {
    // Selected model is no longer installed; the installed one IS vision-capable.
    const h = helperWith({ selected: true, models: [VISION_MODEL] });
    h.ollamaModel = 'deleted-model:70b';
    assert.equal(
      await h.scopeFallbackAvailable(true), true,
      'a stale name must not make the panel claim no local vision when one is installed',
    );
  });

  test('a stale model resolving to a TEXT-only install still reports no vision fallback', async () => {
    const h = helperWith({ selected: true, models: [TEXT_MODEL] });
    h.ollamaModel = 'deleted-vision-model:7b';
    assert.equal(
      await h.scopeFallbackAvailable(true), false,
      'resolving a stale name must not accidentally promote a text-only install to vision',
    );
    assert.equal(await h.scopeFallbackAvailable(false), true);
  });

  test('the probe does NOT mutate the selected model (Settings polls it every 3s)', async () => {
    const h = helperWith({ selected: true, models: [VISION_MODEL] });
    h.ollamaModel = 'deleted-model:70b';
    await h.scopeFallbackAvailable(true);
    assert.equal(
      h.ollamaModel, 'deleted-model:70b',
      'a query must not rewrite the user\'s runtime model selection — the Settings pane polls this',
    );
  });

  test('canUseLocalFallback is left with its looser meaning (WhatToAnswerLLM depends on it)', async () => {
    const h = helperWith({ selected: false, models: [VISION_MODEL] });
    // Deliberately NOT gated on `useOllama`. If this ever starts matching
    // scopeFallbackAvailable, WhatToAnswerLLM.ts:407 changed behaviour silently.
    assert.equal(await h.canUseLocalFallback(false), true);
    assert.equal(await h.scopeFallbackAvailable(false), false);
  });
});
