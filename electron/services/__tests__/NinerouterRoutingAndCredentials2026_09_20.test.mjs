/**
 * The layers around the 9Router dispatch branch: classification, the opt-in
 * allow-list, credential storage and the label.
 *
 * NinerouterDispatchExecutes2026_09_20.test.mjs proves the turn reaches
 * 9Router. This file proves the model can be SELECTED, PERSISTED and GATED —
 * all of which happen in ipcHandlers.ts and CredentialsManager.ts, and none of
 * which the dispatch suite can see.
 *
 * providerFamily/modelAvailable are closures inside a registration function and
 * cannot be imported, so those two are source assertions, matching
 * OpenRouterProvider2026_09_17 and FluxionProvider2026_09_18. Everything that
 * CAN be executed is executed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { isModelAllowed, isOptInModelProvider, litellmModelLabel, gatewayModelLabel } =
  await import(pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href);

const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const creds = fs.readFileSync(path.join(root, 'electron/services/CredentialsManager.ts'), 'utf8');

const NINEROUTER_MODEL = 'ninerouter/gemini/gemini-3.6-flash';

describe('9Router is opt-in, like the other gateways', () => {
  test('isOptInModelProvider claims it', () => {
    // A stock local instance already serves 47 models across 6 upstream
    // aliases, and that is one user's connected accounts — the ceiling is the
    // 40+ providers 9Router supports, not 47. "Empty = all" would put a
    // catalogue nobody chose into the meeting-overlay picker.
    assert.equal(isOptInModelProvider('ninerouter'), true);
  });

  test('an empty allow-list means NONE for 9Router', () => {
    assert.equal(isModelAllowed('ninerouter', NINEROUTER_MODEL, []), false);
    assert.equal(isModelAllowed('ninerouter', NINEROUTER_MODEL, [NINEROUTER_MODEL]), true);
    // Unchanged for the curated providers.
    assert.equal(isModelAllowed('gemini', 'gemini-3.6-flash', []), true);
  });

  test('DRIFT GUARD: routing mirrors the opt-in carve-out', () => {
    // modelAvailable() cannot import the renderer helper (electron/ never
    // imports from src/), so it re-states the rule. Named separately from the
    // litellm/openrouter members because `family === 'litellm'` is a PREFIX of
    // the disjunction: an assertion on that alone keeps passing when a new
    // opt-in family is added to the renderer and forgotten here.
    const fn = ipc.slice(ipc.indexOf('const modelAvailable ='), ipc.indexOf('if (modelAvailable(defaultModel)) return null;'));
    assert.match(fn, /const optInFamily = [^;]*family === 'ninerouter'/,
      '9Router must be opt-in in routing too, or the picker offers what the router rejects');
  });
});

describe('a 9Router id is classified before every vendor catch-all', () => {
  // The whole point. `ninerouter/openai/gpt-5` is an includes('openai') match
  // and `ninerouter/gemini/...` reaches the gemini- branch; classified late,
  // either is gated by — and billed to — the user's real vendor key.
  const familyFn = ipc.slice(ipc.indexOf('const providerFamily ='), ipc.indexOf('const modelAvailable ='));
  const availFn = ipc.slice(ipc.indexOf('const modelAvailable ='), ipc.indexOf('if (modelAvailable(defaultModel)) return null;'));

  const before = (haystack, first, second, label) => {
    const a = haystack.indexOf(first);
    const b = haystack.indexOf(second);
    assert.notEqual(a, -1, `${label}: missing ${first}`);
    assert.notEqual(b, -1, `${label}: missing ${second}`);
    assert.ok(a < b, `${label}: ${first} must be tested BEFORE ${second}`);
  };

  test('providerFamily returns ninerouter, above groq/openai/gemini/claude', () => {
    assert.match(familyFn, /if \(modelId\.startsWith\('ninerouter\/'\)\) return 'ninerouter';/);
    before(familyFn, "startsWith('ninerouter/')", "isKnownGroqModel(modelId)", 'providerFamily');
    before(familyFn, "startsWith('ninerouter/')", "modelId.includes('openai')", 'providerFamily');
    before(familyFn, "startsWith('ninerouter/')", "startsWith('gemini-')", 'providerFamily');
    before(familyFn, "startsWith('ninerouter/')", "startsWith('claude-')", 'providerFamily');
  });

  test('modelAvailable gates 9Router on the BASE URL, above the vendor lines', () => {
    // The base URL, not the key: 9Router's own REQUIRE_API_KEY defaults to
    // false, so a stock local instance is legitimately keyless and gating on a
    // key would make a working install unselectable.
    assert.match(availFn, /if \(modelId\.startsWith\('ninerouter\/'\)\) return has\(cm\.getNinerouterBaseURL\(\)\);/);
    before(availFn, "startsWith('ninerouter/')", "isKnownGroqModel(modelId)", 'modelAvailable');
    before(availFn, "startsWith('ninerouter/')", "modelId.includes('openai')", 'modelAvailable');
    before(availFn, "startsWith('ninerouter/')", "startsWith('gemini-')", 'modelAvailable');
  });
});

describe('a 9Router-only user gets a fallback default', () => {
  test('refreshRuntimeDefaultIfUnavailable has a 9Router rung', () => {
    // The symptom without one is written on the OpenRouter rung beside it: "a
    // user whose only working provider is OpenRouter is left pinned to a dead
    // default and told 'No AI providers configured'". Fluxion earned its rung
    // after exactly that, with its preferred model already stored and returned
    // to the renderer but never consulted here.
    //
    // Cheap for the same reason theirs is: no catalogue fetch, because
    // modelAvailable() already enforces the base URL, the disabled switch and
    // the opt-in allow-list, so an id the user never ticked cannot be installed.
    const fn = ipc.slice(ipc.indexOf('const refreshRuntimeDefaultIfUnavailable'), ipc.indexOf("console.warn('[IPC] refreshRuntimeDefaultIfUnavailable"));
    assert.match(fn, /const ninerouterFallbackModel[^\n]*getPreferredModel\?\.\('ninerouter'\)/,
      'the stored 9Router default must be read');
    assert.match(fn, /ninerouterFallbackModel && modelAvailable\(ninerouterFallbackModel\)/,
      'and consulted in the ladder, gated through modelAvailable like every other rung');
  });
});

describe('credentials round-trip', () => {
  test('PreferredModelProvider and the matching field both exist', () => {
    // The getter builds the key by concatenation (`${provider}PreferredModel`),
    // so a union member without the field silently reads and writes undefined —
    // the failure the type's own docblock warns about.
    assert.match(creds, /export type PreferredModelProvider = [^;]*'ninerouter'/);
    assert.match(creds, /ninerouterPreferredModel\?: string;/);
    assert.match(creds, /ninerouterBaseURL\?: string;/);
    assert.match(creds, /ninerouterApiKey\?: string;/);
  });

  // NOT the guard — and worth saying so. Both accessors go through
  // `(this.credentials as any)[key]`, so the compiled JS accepts any provider
  // name and this round-trip passes with or without the union member. The
  // source assertions above are what actually hold the contract; this proves
  // only that the storage mechanism persists and returns the value.
  test('setPreferredModel("ninerouter") is readable back', () => {
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
      id: electronPath, filename: electronPath, loaded: true,
      exports: {
        app: { isReady: () => true, getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'nr-creds-')), getVersion: () => '0.0.0-test' },
        safeStorage: { isEncryptionAvailable: () => false },
      },
    };
    const { CredentialsManager } = require(path.join(root, 'dist-electron/electron/services/CredentialsManager.js'));
    const cm = CredentialsManager.getInstance();
    cm.setPreferredModel('ninerouter', NINEROUTER_MODEL);
    assert.equal(cm.getPreferredModel('ninerouter'), NINEROUTER_MODEL,
      'the interpolated key must match a real StoredCredentials field');
  });
});

describe('the label drops both prefixes', () => {
  test('a 9Router id renders as the bare model name', () => {
    // Two prefixes stack: `ninerouter/` is Natively's routing prefix and
    // `gemini/` is 9Router's own upstream namespace. Neither is identity, and
    // neither belongs on screen.
    //
    // litellmModelLabel already returns the right answer for these, because it
    // takes the LAST segment — but only by accident: its strip is a literal
    // /^litellm\//, so `ninerouter/` survives it and simply happens to be a
    // segment that gets dropped anyway. A one-segment id would expose that
    // (`ninerouter` alone labels as "ninerouter"), and the name of the function
    // tells the next reader it does not apply here. Hence a named export.
    assert.equal(typeof gatewayModelLabel, 'function', 'gatewayModelLabel must exist');
    assert.equal(gatewayModelLabel(NINEROUTER_MODEL), 'gemini-3.6-flash');
    assert.equal(gatewayModelLabel('ninerouter/openai/gpt-5'), 'gpt-5');
    // 9Router also serves combos, which are single-segment ids.
    assert.equal(gatewayModelLabel('ninerouter/vip'), 'vip');
    // Unchanged for LiteLLM, whose callers still use the old name.
    assert.equal(litellmModelLabel('litellm/openai/gpt-4o'), 'gpt-4o');
    assert.equal(gatewayModelLabel('litellm/openai/gpt-4o'), 'gpt-4o');
  });
});
