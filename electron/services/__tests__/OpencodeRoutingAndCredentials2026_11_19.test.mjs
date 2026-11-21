/**
 * Routing, credential and prefix guards for OpenCode.
 *
 * The ordering assertions are structural: they parse the function body rather
 * than grepping the whole file, because by the end of the integration the
 * string `opencode` appears in comments all over `LLMHelper.ts` and `ipcHandlers.ts`.
 *
 * The strip assertions EXECUTE the shared prefix helper. That one is the
 * difference between `opencode/gpt-6.1-sol` reaching the OpenAI client as
 * `gpt-6.1-sol` (right) and as `6.1-sol` (a 404 on every turn).
 *
 * Run: node --test electron/services/__tests__/OpencodeRoutingAndCredentials2026_11_19.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(root, 'dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

/** The body of a closure declared as `const NAME = (...) => { ... }`. */
function arrowBody(source, name, maxLines = 220) {
  const decl = source.indexOf(`const ${name} = `);
  assert.notEqual(decl, -1, `${name} not found — was it renamed?`);
  const open = source.indexOf('{', source.indexOf('=>', decl));
  assert.notEqual(open, -1, `${name} has no block body`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`${name} braces did not balance`);
}

/** Position of a token in a function body, or Infinity. */
const at = (body, token) => body.indexOf(token);

describe('providerFamily and modelAvailable classify OpenCode before every vendor', () => {
  const family = arrowBody(ipc, 'providerFamily');
  const available = arrowBody(ipc, 'modelAvailable');

  for (const [name, body] of [['providerFamily', family], ['modelAvailable', available]]) {
    test(`${name}: opencode sits above the other gateways`, () => {
      const oc = at(body, "startsWith('opencode/')");
      assert.notEqual(oc, -1, `${name} has no opencode branch`);
      for (const other of ['openrouter/', 'fluxion/', 'agentrouter/', 'ninerouter/', 'nvidia_nim/', 'litellm/']) {
        assert.ok(oc < at(body, `startsWith('${other}')`), `${name}: opencode must precede ${other}`);
      }
    });

    test(`${name}: opencode sits above every vendor predicate`, () => {
      const oc = at(body, "startsWith('opencode/')");
      for (const vendor of ['gemini-', 'claude-', 'ollama-']) {
        assert.ok(oc < at(body, `startsWith('${vendor}')`), `${name}: opencode must precede ${vendor}`);
      }
      assert.ok(oc < at(body, 'isOpenAiModelId('), `${name}: opencode must precede isOpenAiModelId`);
      assert.ok(oc < at(body, 'isKnownGroqModel('), `${name}: opencode must precede isKnownGroqModel`);
    });
  }

  test('an OpenCode model is gated by the OpenCode key, not a vendor key', () => {
    const line = available.slice(available.indexOf("startsWith('opencode/')"));
    assert.match(line, /has\(cm\.getOpencodeApiKey\(\)\)/);
    assert.doesNotMatch(line.slice(0, line.indexOf(';')), /getClaudeApiKey|getOpenaiApiKey|getGeminiApiKey/);
  });

  test('OpenCode is NOT opt-in (a bounded catalogue is not a 300-model proxy)', () => {
    const utils = fs.readFileSync(path.join(root, 'src/utils/modelUtils.ts'), 'utf8');
    const fn = utils.slice(utils.indexOf('export const isOptInModelProvider'));
    const body = fn.slice(0, fn.indexOf(';') + 1);
    assert.doesNotMatch(body, /opencode/, 'adding opencode to the opt-in set would hide every preset until ticked');
  });
});

describe('the shared prefix strip is one segment for OpenCode', () => {
  const { stripProviderRoutingPrefix } = require(dist('llm/modelCapabilities.js'));

  test('bare vendor ids keep their model name', () => {
    // Two segments would produce `6.1-sol` / `sonnet-5` / `3.8-flash`.
    assert.equal(stripProviderRoutingPrefix('opencode/gpt-6.1-sol'), 'gpt-6.1-sol');
    assert.equal(stripProviderRoutingPrefix('opencode/claude-sonnet-5'), 'claude-sonnet-5');
    assert.equal(stripProviderRoutingPrefix('opencode/gemini-3.8-flash'), 'gemini-3.8-flash');
    assert.equal(stripProviderRoutingPrefix('opencode/deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
  });

  test('the upstream-namespaced gateways still strip two', () => {
    assert.equal(stripProviderRoutingPrefix('openrouter/anthropic/claude-sonnet-5'), 'claude-sonnet-5');
    assert.equal(stripProviderRoutingPrefix('ninerouter/gemini/gemini-3.6-flash'), 'gemini-3.6-flash');
    assert.equal(stripProviderRoutingPrefix('litellm/openai/gpt-4o'), 'gpt-4o');
  });

  test('the other bare-id gateways are unchanged', () => {
    assert.equal(stripProviderRoutingPrefix('fluxion/claude-opus-5'), 'claude-opus-5');
    assert.equal(stripProviderRoutingPrefix('agentrouter/gpt-6-astra'), 'gpt-6-astra');
  });

  test('capabilities resolve to cloud for an OpenCode id', () => {
    const { getModelCapabilities } = require(dist('llm/modelCapabilities.js'));
    for (const id of ['opencode/claude-sonnet-5', 'opencode/gpt-6.1-sol', 'opencode/kimi-k3']) {
      const caps = getModelCapabilities(id, false);
      assert.equal(caps.tier, 'cloud', `${id} must be a cloud-tier model`);
    }
  });
});

describe('vendor predicates exclude OpenCode at the source', () => {
  for (const fn of ['isOpenAiModel', 'isClaudeModel', 'isGeminiModel', 'isDeepseekModel', 'isGroqModel']) {
    test(`${fn} refuses OpenCode ids directly`, () => {
      const decl = helper.indexOf(`private ${fn}(`);
      assert.notEqual(decl, -1, `${fn} not found`);
      const body = helper.slice(decl, helper.indexOf('\n  }', decl));
      assert.match(body, /this\.isOpencodeModel\(modelId\)/, `${fn} must exclude OpenCode, not rely on branch order`);
    });
  }
});

describe('CredentialsManager owns the catalogue lifecycle', () => {
  const { CredentialsManager } = require(dist('services/CredentialsManager.js'));

  function bareCredentials(initial = {}) {
    const cm = Object.create(CredentialsManager.prototype);
    cm.credentials = { ...initial };
    cm.saveCredentials = () => true;
    cm.refuseWriteWhileDegraded = () => false;
    return cm;
  }

  test('clearing the key clears the catalogue it was fetched with', () => {
    const cm = bareCredentials({
      opencodeApiKey: 'oc_sk_old',
      opencodeModelMeta: { 'claude-sonnet-5': { api: 'messages', baseUrl: 'x', vision: true } },
      opencodeVisionModels: ['claude-sonnet-5'],
      opencodePreferredModel: 'opencode/claude-sonnet-5',
    });
    assert.equal(cm.setOpencodeApiKey(''), true);
    assert.equal(cm.getOpencodeApiKey(), undefined);
    assert.deepEqual(cm.getOpencodeModelMeta(), {});
    assert.deepEqual(cm.getOpencodeVisionModels(), []);
    assert.equal(cm.getPreferredModel('opencode'), undefined);
  });

  test('saving a key keeps the catalogue (it is written separately)', () => {
    const cm = bareCredentials({});
    assert.equal(cm.setOpencodeApiKey('  oc_sk_new  '), true);
    assert.equal(cm.getOpencodeApiKey(), 'oc_sk_new');
  });

  test('a CHANGED key drops the previous workspace\'s catalogue; a same-key re-save keeps it', () => {
    const cm = bareCredentials({
      opencodeApiKey: 'oc_sk_old',
      opencodeModelMeta: { 'claude-sonnet-5': { api: 'messages', baseUrl: 'x', vision: true } },
      opencodeVisionModels: ['claude-sonnet-5'],
      opencodePreferredModel: 'opencode/claude-sonnet-5',
    });
    // Same key → nothing is lost.
    cm.setOpencodeApiKey('oc_sk_old');
    assert.equal(Object.keys(cm.getOpencodeModelMeta()).length, 1);

    // New key → the old catalogue names models this workspace may not serve.
    cm.setOpencodeApiKey('oc_sk_new');
    assert.deepEqual(cm.getOpencodeModelMeta(), {});
    assert.deepEqual(cm.getOpencodeVisionModels(), []);
    assert.equal(cm.getPreferredModel('opencode'), undefined);
  });

  test('a degraded store refuses the write and leaves memory untouched', () => {
    const cm = bareCredentials({ opencodeApiKey: 'oc_sk_old' });
    cm.refuseWriteWhileDegraded = () => true;
    assert.equal(cm.setOpencodeApiKey('oc_sk_new'), false);
    assert.equal(cm.getOpencodeApiKey(), 'oc_sk_old');
  });

  test('the preferred-model key is the interpolated field the generic accessor writes', () => {
    const cm = bareCredentials({});
    cm.setPreferredModel('opencode', 'opencode/gpt-6.1-sol');
    assert.equal(cm.credentials.opencodePreferredModel, 'opencode/gpt-6.1-sol');
    assert.equal(cm.getPreferredModel('opencode'), 'opencode/gpt-6.1-sol');
  });
});

describe('an OpenCode key counts as the user\'s own AI route', () => {
  test('trialPolicy recognises it, or the trial-ended card would wipe profile data', async () => {
    const { hasOwnAiKey } = await import(
      new URL('../../../src/lib/trialPolicy.mjs', import.meta.url).href
    );
    assert.equal(hasOwnAiKey({ opencodeApiKey: 'oc_sk_test' }, {}), true);
    assert.equal(hasOwnAiKey({ opencodeApiKey: '' }, {}), false);
  });
});
