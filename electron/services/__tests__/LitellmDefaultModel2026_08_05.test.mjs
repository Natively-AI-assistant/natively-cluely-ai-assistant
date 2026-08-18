// Behavioral + source-level guardrails for the LiteLLM per-provider default model.
//
// Before this, LiteLLM was the only configured provider whose model list had no
// "set as default" control: there was no `litellmPreferredModel` credential, so
// the runtime fallback in ipcHandlers.refreshRuntimeDefaultIfUnavailable() always
// installed whichever model the proxy happened to list FIRST.
//
// The behavioral half runs against the COMPILED CredentialsManager with real disk
// I/O in a temp userData dir (same harness shape as CredentialPersistenceBehavior),
// because the invalidation rules — cleared on remove, cleared on repoint, KEPT on a
// same-URL re-save — are exactly the kind of thing source-text assertions pass green
// on while the stored value silently survives a proxy change.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/LitellmDefaultModel2026_08_05.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const COMPILED = path.resolve(root, 'dist-electron/electron/services/CredentialsManager.js');

// ── Compiled-module harness (electron mocked, real disk in a temp dir) ────────
function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'litellm-default-'));
  const state = { userData };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test' },
    safeStorage: {
      // Keyring unavailable → the encrypted app-managed fallback path, which is the
      // one that actually round-trips through disk in this environment.
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(2).toString('utf8'),
      getSelectedStorageBackend: () => 'basic_text',
    },
  };
  return { state, fakeElectron, userData };
}

let CURRENT = null;
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    if (!CURRENT) throw new Error('no electron env active');
    return CURRENT.fakeElectron;
  }
  return origLoad.apply(this, arguments);
};

// A cold start: cleared module cache + reset singleton, so state must come off disk.
function freshManager(env) {
  CURRENT = env;
  delete require.cache[require.resolve(COMPILED)];
  const mod = require(COMPILED);
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return cm;
}

const PROXY = 'http://localhost:4000/v1';
const OTHER_PROXY = 'http://gateway.internal:8000/v1';
const DEFAULT_MODEL = 'litellm/claude-sonnet-4-6';

describe('CredentialsManager — LiteLLM preferred model', () => {
  test('set → survives a restart, and reads back through the generic getter', () => {
    const env = makeEnv();
    const cm = freshManager(env);
    cm.setLitellmConfig('', PROXY);
    cm.setPreferredModel('litellm', DEFAULT_MODEL);

    const cm2 = freshManager(env);
    assert.equal(
      cm2.getPreferredModel('litellm'),
      DEFAULT_MODEL,
      'the LiteLLM default must persist like every other provider default',
    );
  });

  test('a same-URL re-save (e.g. changing only max-tokens) KEEPS the default', () => {
    const env = makeEnv();
    const cm = freshManager(env);
    cm.setLitellmConfig('sk-virtual', PROXY);
    cm.setPreferredModel('litellm', DEFAULT_MODEL);

    // The common case: the user edits max-tokens and presses Save. The masked key
    // field is blank, meaning "keep". Nothing about the catalogue changed.
    cm.setLitellmConfig('', PROXY, 4096);

    assert.equal(
      cm.getPreferredModel('litellm'),
      DEFAULT_MODEL,
      'an unrelated re-save must not silently drop the chosen default',
    );
    assert.equal(cm.getLitellmMaxTokens(), 4096, 'the re-save itself must still apply');
  });

  test('repointing at a different proxy clears the default (it named a model on the old host)', () => {
    const env = makeEnv();
    const cm = freshManager(env);
    cm.setLitellmConfig('', PROXY);
    cm.setPreferredModel('litellm', DEFAULT_MODEL);

    cm.setLitellmConfig('', OTHER_PROXY);

    assert.equal(
      cm.getPreferredModel('litellm'),
      undefined,
      'a default pointing into the previous proxy catalogue must not survive a repoint',
    );
    const cm2 = freshManager(env);
    assert.equal(cm2.getPreferredModel('litellm'), undefined, 'and it must stay cleared across a restart');
  });

  test('removing the proxy (empty baseURL) clears the default with the rest of the config', () => {
    const env = makeEnv();
    const cm = freshManager(env);
    cm.setLitellmConfig('sk-virtual', PROXY);
    cm.setPreferredModel('litellm', DEFAULT_MODEL);

    cm.setLitellmConfig('', '');

    const cm2 = freshManager(env);
    assert.equal(cm2.getLitellmBaseURL(), undefined, 'proxy config should be gone');
    assert.equal(
      cm2.getPreferredModel('litellm'),
      undefined,
      'a default with no proxy behind it would resurrect on the next configure',
    );
  });

  test('setting the LiteLLM default does not disturb another provider default', () => {
    const env = makeEnv();
    const cm = freshManager(env);
    cm.setLitellmConfig('', PROXY);
    cm.setPreferredModel('gemini', 'gemini-3.6-flash');
    cm.setPreferredModel('litellm', DEFAULT_MODEL);

    const cm2 = freshManager(env);
    assert.equal(cm2.getPreferredModel('gemini'), 'gemini-3.6-flash', 'sibling defaults are independent');
    assert.equal(cm2.getPreferredModel('litellm'), DEFAULT_MODEL);
  });
});

// ── Wiring guardrails: the credential must be reachable end-to-end ────────────
describe('LiteLLM default model wiring', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');

  test("the runtime fallback prefers the user's LiteLLM default over the proxy's first model", () => {
    // The fallback block that installs a LiteLLM model when the active model dies.
    const block = ipc.slice(ipc.indexOf('let litellmFallbackModel'), ipc.indexOf('const next = modelAvailable('));
    assert.ok(block.length > 0, 'the LiteLLM fallback block should still exist');
    assert.match(block, /getPreferredModel\?\.\('litellm'\)/, 'the stored default must be consulted');
    assert.match(block, /ids\.includes\(preferredBare\)/, 'it must be confirmed against the live catalogue');
    assert.match(block, /: ids\[0\]/, "and the proxy's first model must remain the fallback-of-the-fallback");
    assert.doesNotMatch(
      block,
      /const firstModel = \(data\?\.data \|\| \[\]\)\.map\(\(m: any\) => m\?\.id\)\.find\(Boolean\)/,
      'the old unconditional first-model pick must be gone',
    );
  });

  test("'litellm' is accepted across the whole preferred-model channel", () => {
    assert.match(
      ipc,
      /'set-provider-preferred-model',\s*\n\s*async \(_, provider: [^)]*\| 'litellm'/,
      'the IPC handler must accept litellm',
    );
    assert.match(
      preload,
      /setProviderPreferredModel: \(provider: [^)]*\| 'litellm', modelId: string\)/,
      'the preload bridge must accept litellm',
    );
    assert.match(ipc, /litellmPreferredModel: creds\.litellmPreferredModel \|\| undefined/, 'get-stored-credentials must return it');
  });

  test('the LiteLLM card exposes the same default control as every other provider', () => {
    const card = settings.slice(settings.indexOf("models={effectiveModels('litellm')}"));
    const list = card.slice(0, card.indexOf('/>'));
    assert.match(list, /defaultId=\{preferredModels\['litellm'\]\}/, 'the star must render from stored state');
    assert.match(
      list,
      /onSetDefault=\{\(modelId\) => handleSetDefaultModel\('litellm', modelId\)\}/,
      'and write through the shared allow-list-first handler',
    );
    assert.match(
      settings,
      /if \(creds\.litellmPreferredModel\) pm\.litellm = creds\.litellmPreferredModel/,
      'loadCredentials must hydrate the LiteLLM default',
    );
  });

  test('the stored LiteLLM default is prefixed, matching every other litellm id surface', () => {
    // An unprefixed name here would make the star land on no row (the list renders
    // `litellm/<model>` ids) and would be rejected by modelAvailable().
    assert.doesNotMatch(
      settings,
      /pm\.litellm = `litellm\/\$\{creds\.litellmPreferredModel\}`/,
      'the renderer must not re-prefix an already-prefixed stored id',
    );
    assert.match(
      ipc,
      /preferred\?\.startsWith\('litellm\/'\)/,
      'the fallback must strip the prefix before comparing against /v1/models ids',
    );
  });
});
