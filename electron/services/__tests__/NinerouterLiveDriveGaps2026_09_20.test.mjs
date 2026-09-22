/**
 * Two gaps that only a live drive exposed.
 *
 * Driving the real app end-to-end against a running 9Router — save the config,
 * refresh the catalogue, tick a model, make it active — passed every check but
 * printed this:
 *
 *   displayName: "ninerouter/minimax/MiniMax-M3"
 *
 * which is the raw routed id, in a 140px truncating chip. LiteLLM has a branch
 * for exactly that, with a comment saying it MUST sit above the displayName
 * branch; 9Router had none.
 *
 * Looking for the second half of that omission found the worse one: the
 * catalogue fetch stores `ninerouterModelInputCaps` and NOTHING reads it. On
 * the LiteLLM side the equivalent cap is folded into the context budget, and
 * its comment records what happens without it — a proxied id resolves to the
 * full "cloud" tier, so a small model behind the proxy receives a cloud-sized
 * prompt and either 400s or is silently truncated upstream. A stored-but-unread
 * field is the shape of a guard that looks present and does nothing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};
const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));

describe('the overlay chip shows a model name, not a routed id', () => {
  const ui = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');

  test('a ninerouter id is labelled before the displayName fallback', () => {
    // Order is the whole point, and the LiteLLM comment beside it says why:
    // getCurrentModelDisplayName() returns currentModelId verbatim for a
    // gateway, so the displayName branch would render the full routed id.
    const litellmAt = ui.indexOf("m.startsWith('litellm/')");
    const nineAt = ui.indexOf("m.startsWith('ninerouter/')");
    const displayNameAt = ui.indexOf('currentModelDisplayName && currentModelDisplayName !== m');
    assert.notEqual(nineAt, -1, 'the chip must special-case a 9Router id');
    assert.ok(nineAt < displayNameAt,
      'it must sit ABOVE the displayName branch, or the raw id renders in a 140px chip');
    assert.ok(litellmAt < displayNameAt, 'the LiteLLM branch must keep its position too');
  });
});

describe('the catalogue input ceiling is actually consulted', () => {
  test('ninerouterInputCapFor reads the cache the catalogue fetch fills', () => {
    const h = Object.create(LLMHelper.prototype);
    h.ninerouterModelInputCaps = new Map([['gemini/gemini-3.6-flash', 32000]]);

    assert.equal(typeof h.ninerouterInputCapFor, 'function', 'the accessor must exist');
    // Keyed by the WIRE id — one prefix segment off, matching what the catalogue
    // returned and what resolveNinerouterMaxTokens looks up.
    assert.equal(h.ninerouterInputCapFor('ninerouter/gemini/gemini-3.6-flash'), 32000);
    // Not gateway-routed, or not in the catalogue: no extra cap, never zero.
    assert.equal(h.ninerouterInputCapFor('ninerouter/openai/gpt-5'), null);
    assert.equal(h.ninerouterInputCapFor('gpt-5'), null);
    assert.equal(h.ninerouterInputCapFor(''), null);
  });

  test('a small model behind 9Router gets its prompt trimmed', () => {
    // The defect in one assertion. Without the cap the id resolves to the full
    // cloud tier, fitContextForCurrentModel returns early for anything at or
    // above 100k, and a 32k model receives a cloud-sized prompt.
    const h = Object.create(LLMHelper.prototype);
    h.useOllama = false;
    h.currentModelId = 'ninerouter/gemini/gemini-3.6-flash';
    h.litellmModelInputCaps = new Map();
    h.ninerouterModelInputCaps = new Map([['gemini/gemini-3.6-flash', 8000]]);

    const huge = Array.from({ length: 20000 }, (_, i) => `line ${i} of transcript`).join('\n');
    const fitted = LLMHelper.prototype.fitContextForCurrentModel.call(h, huge);
    assert.ok(fitted.length < huge.length,
      'an 8k-input model behind 9Router must have its prompt trimmed, not sent whole');
  });

  test('with no reported ceiling, behaviour is unchanged', () => {
    // The catalogue not reporting a window means "no extra cap" — never "cap at
    // zero", which would trim every prompt to nothing.
    const h = Object.create(LLMHelper.prototype);
    h.useOllama = false;
    h.currentModelId = 'ninerouter/openai/gpt-5';
    h.litellmModelInputCaps = new Map();
    h.ninerouterModelInputCaps = new Map();

    const text = 'short prompt';
    assert.equal(LLMHelper.prototype.fitContextForCurrentModel.call(h, text), text);
  });
});
