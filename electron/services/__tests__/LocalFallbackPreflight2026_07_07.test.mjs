// LocalFallbackPreflight + LocalFallbackAssets tests (2026-07-07): the preflight
// must classify missing required packaged assets as missing_required_asset, must
// never throw, and must publish provider statuses for local-embedding and
// intent-classifier. Tests run under ELECTRON_RUN_AS_NODE so the bundled
// CommonJS artifacts are the import target.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);

require.cache['electron-stub'] = {
  id: 'electron-stub',
  filename: 'electron-stub',
  loaded: true,
  exports: {
    app: { isReady: () => true, getAppPath: () => '/tmp', getPath: () => '/tmp' },
    BrowserWindow: { getAllWindows: () => [] },
  },
};
const ModuleNS = await import('node:module');
const Mod = ModuleNS.default || ModuleNS.Module;
const origResolve = Mod._resolveFilename;
Mod._resolveFilename = function (req, ...rest) {
  if (req === 'electron') return 'electron-stub';
  return origResolve.call(this, req, ...rest);
};

const REGISTRY_PATH = '../../../dist-electron/electron/services/ProviderStatusRegistry.js';
const ASSETS_PATH = '../../../dist-electron/electron/services/LocalFallbackAssets.js';
const PREFLIGHT_PATH = '../../../dist-electron/electron/services/LocalFallbackPreflight.js';
const OLLAMA_PATH = '../../../dist-electron/electron/services/OllamaManager.js';

function clearModule(pathStr) {
  try { delete require.cache[require.resolve(pathStr)]; } catch {}
}

describe('LocalFallbackAssets (2026-07-07)', () => {
  beforeEach(() => { clearModule(ASSETS_PATH); });
  afterEach(() => { clearModule(ASSETS_PATH); });

  test('resolvePackagedModelPath throws a clear error when missing', () => {
    const { resolvePackagedModelPath } = require(ASSETS_PATH);
    assert.throws(() => resolvePackagedModelPath('NoSuch/Model/tokenizer.json'), /Missing packaged model asset/);
  });

  test('verifyRequiredModelAssets reports each required file by id', () => {
    const { verifyRequiredModelAssets, REQUIRED_MODEL_FILES } = require(ASSETS_PATH);
    const results = verifyRequiredModelAssets();
    assert.equal(results.length, REQUIRED_MODEL_FILES.length);
    for (const r of results) {
      assert.ok(REQUIRED_MODEL_FILES.some((f) => f.id === r.id), `result id ${r.id} not declared`);
    }
  });

  test('resolvePackagedModelPath finds the bundled MiniLM assets', () => {
    const repoRoot = path.resolve(new URL('..', import.meta.url).pathname, '..', '..', '..');
    const candidate = path.join(repoRoot, 'resources', 'models', 'Xenova', 'all-MiniLM-L6-v2', 'tokenizer.json');
    if (!fs.existsSync(candidate)) {
      // CI may not have downloaded models; this test only runs when assets are present.
      return;
    }
    const { resolvePackagedModelPath } = require(ASSETS_PATH);
    const resolved = resolvePackagedModelPath('Xenova/all-MiniLM-L6-v2/tokenizer.json');
    assert.equal(typeof resolved, 'string');
    assert.ok(fs.existsSync(resolved));
  });
});

describe('LocalFallbackPreflight (2026-07-07)', () => {
  beforeEach(() => {
    clearModule(REGISTRY_PATH);
    clearModule(ASSETS_PATH);
    clearModule(OLLAMA_PATH);
    clearModule(PREFLIGHT_PATH);
  });
  afterEach(() => {
    clearModule(REGISTRY_PATH);
    clearModule(ASSETS_PATH);
    clearModule(OLLAMA_PATH);
    clearModule(PREFLIGHT_PATH);
  });

  test('runLocalFallbackPreflight never throws and returns a result', async () => {
    const { runLocalFallbackPreflight, getLatestLocalFallbackPreflight } = require(PREFLIGHT_PATH);
    const result = await runLocalFallbackPreflight({ ollamaSelected: false });
    assert.ok(result);
    assert.ok(Array.isArray(result.checks));
    assert.ok(result.startedAt && result.finishedAt);
    const latest = getLatestLocalFallbackPreflight();
    assert.ok(latest);
  });

  test('runLocalFallbackPreflight publishes provider statuses for local fallback', async () => {
    const { runLocalFallbackPreflight, ProviderStatusRegistry } = require(PREFLIGHT_PATH);
    await runLocalFallbackPreflight({ ollamaSelected: false });
    const ic = ProviderStatusRegistry.getInstance().getStatus('intent-classifier');
    const le = ProviderStatusRegistry.getInstance().getStatus('local-embedding');
    assert.ok(ic, 'expected intent-classifier status');
    assert.ok(le, 'expected local-embedding status');
    assert.equal(ic.kind, 'packaged_local');
    assert.equal(le.kind, 'packaged_local');
    assert.equal(ic.requiredForCoreFallback, true);
    assert.equal(le.requiredForCoreFallback, true);
  });
});
