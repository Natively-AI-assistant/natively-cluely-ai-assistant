/**
 * Three blocking defects found by a production-readiness review of the 9Router
 * integration. Each is reproduced here before being fixed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
const { getModelCapabilities } = require(path.join(root, 'dist-electron/electron/llm/modelCapabilities.js'));

describe('Direct Assist sizes the prompt against the SAME capabilities it dispatches with', () => {
  test('a gateway id must reach getModelCapabilities whole', () => {
    // The bug: the Direct Assist path pre-stripped `ninerouter/`, which is
    // exactly what stops ROUTING_PREFIX_RE matching — so the VENDOR segment
    // survives and the id resolves as something else entirely.
    //
    //   ninerouter/qwen/qwen3-8b  full ->  qwen3-8b   -> 128000 ctx (cloud)
    //                       stripped ->  qwen/qwen3-8b ->   8000 ctx (local-small)
    //
    // requestBuilder sizes against the FULL id, so the two disagreed by 16x and
    // the dispatcher threw CONTEXT_TOO_LARGE on a prompt just declared legal.
    // It also disabled modelCapabilities' `!isGatewayRouted` guard, re-opening
    // the litellm/qwen vision bug that guard was added for.
    const full = getModelCapabilities('ninerouter/qwen/qwen3-8b', false);
    const preStripped = getModelCapabilities('qwen/qwen3-8b', false);
    assert.notEqual(full.maxContextTokens, preStripped.maxContextTokens,
      'sanity: these must differ, or this test proves nothing');

    const src = require('node:fs').readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
    const block = src.slice(src.indexOf('const capabilityModel ='), src.indexOf('const capabilityModel =') + 900);
    assert.doesNotMatch(block, /provider === 'ninerouter'/,
      'ninerouter must fall through to the FULL id, exactly as openrouter does');
  });
});

describe('the catalogue is fetched even when Max Output Tokens is set manually', () => {
  test('a manual override must not starve the vision set', async () => {
    // The bug: refreshNinerouterModelCatalogue had exactly ONE caller, inside
    // resolveNinerouterMaxTokens and AFTER its manual-override early return. So
    // choosing a fixed Max Output Tokens meant the catalogue was never fetched,
    // ninerouterVisionModels stayed empty, and the per-model vision gate — the
    // one thing this provider does that LiteLLM cannot — silently answered
    // "true" for every model, forever.
    const h = Object.create(LLMHelper.prototype);
    Object.assign(h, {
      ninerouterApiKey: 'sk-x',
      ninerouterBaseURL: 'http://localhost:20128/v1',
      ninerouterMaxTokens: 4096,          // the manual override
      ninerouterModelBudgets: new Map(),
      ninerouterModelInputCaps: new Map(),
      ninerouterVisionModels: new Set(),
      ninerouterModelsFetchedAt: 0,
      ninerouterModelsFetch: null,
    });

    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = async () => {
      fetched++;
      return {
        ok: true,
        json: async () => ({ data: [
          { id: 'gemini/sees', capabilities: { vision: true, maxOutput: 8192, contextWindow: 32000 } },
          { id: 'alicode/blind', capabilities: { vision: false, maxOutput: 4096, contextWindow: 16000 } },
        ] }),
      };
    };
    try {
      const mt = await LLMHelper.prototype.resolveNinerouterMaxTokens.call(h, 'gemini/sees');
      assert.equal(mt, 4096, 'the manual override must still win for max_tokens');
      assert.equal(fetched, 1, 'but the catalogue must have been fetched anyway');
      assert.ok(h.ninerouterVisionModels.has('gemini/sees'), 'vision set must be populated');
      assert.ok(!h.ninerouterVisionModels.has('alicode/blind'));
      assert.equal(h.ninerouterModelInputCaps.get('gemini/sees'), 32000,
        'input caps must be populated too, or fitContextForCurrentModel never trims');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('the main streaming chat path honours the vision gate', () => {
  test('a text-only model is not sent the screenshot', () => {
    // The bug: four call sites, three answers. The non-streaming cascade and the
    // vision chain both gated on ninerouterModelSupportsVision; the PRIMARY
    // streaming chat branch forwarded images unconditionally. That is the most
    // travelled of the four, and 9Router returns HTTP 200 for an image sent to
    // a text-only model — so the failure is a confident answer that ignored the
    // user's screenshot, not an error anything can recover from.
    const src = require('node:fs').readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
    // Anchor on the CHAT rung specifically. `id: 'ninerouter',` also appears in
    // the vision chain, which already gated — matching the first occurrence
    // tested the wrong call site.
    const at = src.indexOf('const ninerouterSystem =');
    assert.notEqual(at, -1, 'the streaming chat rung must exist');
    const rung = src.slice(at, at + 1400);
    assert.match(rung, /ninerouterModelSupportsVision/,
      'the streaming chat rung must gate images on the model capability');
    assert.doesNotMatch(rung, /\(isMultimodal && imagePaths\) \? imagePaths : undefined/,
      'the ungated forward must be gone');
  });
});
