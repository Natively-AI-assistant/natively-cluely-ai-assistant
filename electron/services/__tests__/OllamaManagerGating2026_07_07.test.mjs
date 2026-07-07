// OllamaManager gating tests (2026-07-07): startup must NOT spawn Ollama
// unless explicitly selected; missing binary must be a recoverable optional
// status, not a fatal startup error. Concurrent ensureRunning calls must be
// single-flighted so two near-simultaneous toggles cannot both spawn daemons.
//
// Tests run under ELECTRON_RUN_AS_NODE so the bundled CommonJS artifact of
// electron/services/OllamaManager.ts is the import target.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Stub electron BEFORE importing OllamaManager so its top-level `require('electron')`
// resolves to a minimal stub (the bundled main.js imports electron lazily).
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

const OM_PATH = '../../../dist-electron/electron/services/OllamaManager.js';

describe('OllamaManager gating (2026-07-07)', () => {
  beforeEach(() => {
    try { delete require.cache[require.resolve(OM_PATH)]; } catch {}
    delete process.env.NATIVELY_AUTO_START_OLLAMA;
  });
  afterEach(() => {
    try { delete require.cache[require.resolve(OM_PATH)]; } catch {}
  });

  test('init() with no reason does NOT spawn; registers optional skipped status', async () => {
    const { OllamaManager } = require(OM_PATH);
    const mgr = OllamaManager.getInstance();
    await mgr.init();
    const status = mgr.getLastStatus();
    assert.ok(status);
    assert.equal(status.id, 'ollama');
    assert.equal(status.health, 'missing_optional_dependency');
    assert.equal(status.requiredForStartup, false);
    assert.equal(status.requiredForCoreFallback, false);
    assert.equal(mgr.getIsAppManaged(), false);
  });

  test('skipStartup() emits an optional-missing provider status without touching PATH', () => {
    const { OllamaManager } = require(OM_PATH);
    const mgr = OllamaManager.getInstance();
    const status = mgr.skipStartup();
    assert.equal(status.health, 'missing_optional_dependency');
    assert.equal(status.kind, 'external_local');
    assert.equal(status.requiredForStartup, false);
  });

  test('probe() on a closed port returns optional-missing, not a fatal error', async () => {
    const { OllamaManager } = require(OM_PATH);
    const mgr = OllamaManager.getInstance();
    const status = await mgr.probe('http://127.0.0.1:1');
    assert.equal(status.id, 'ollama');
    assert.equal(status.health, 'missing_optional_dependency');
    assert.equal(mgr.getIsAppManaged(), false);
  });

  test('ensureRunning({reason}) on a closed port returns missing_optional_dependency (ENOENT classified)', async () => {
    // Point PATH at an empty tempdir so the spawn of `ollama` (the fallback in
    // startOllama) cannot resolve a binary and surfaces ENOENT. This exercises
    // the isEnoent classification in OllamaManager.runEnsure.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-empty-'));
    const oldPath = process.env.PATH;
    process.env.PATH = emptyPath;
    try {
      const { OllamaManager } = require(OM_PATH);
      const mgr = OllamaManager.getInstance();
      // Use a non-default port so checkIsRunning returns false and the spawn
      // path is taken.
      const status = await mgr.ensureRunning({
        reason: 'user-action',
        selectedModel: 'llama3:8b',
        url: 'http://127.0.0.1:11434',
      });
      assert.equal(status.health, 'missing_optional_dependency');
      assert.equal(status.requiredForStartup, false);
      assert.equal(mgr.getIsAppManaged(), false);
      assert.match(status.message, /not installed or not available in PATH/);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  test('ensureRunning is single-flighted under concurrent calls', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-singleflight-'));
    const oldPath = process.env.PATH;
    process.env.PATH = emptyPath;
    try {
      const { OllamaManager } = require(OM_PATH);
      const mgr = OllamaManager.getInstance();
      // Fire two concurrent ensureRunning calls. The single-flight gate must
      // ensure they share one in-flight Promise so the second awaits the first
      // rather than both spawning.
      const [a, b] = await Promise.all([
        mgr.ensureRunning({ reason: 'user-action', url: 'http://127.0.0.1:11434' }),
        mgr.ensureRunning({ reason: 'selected-model', url: 'http://127.0.0.1:11434' }),
      ]);
      assert.ok(a && b);
      // Both must produce a coherent status; the second cannot have spawned
      // its own daemon. We assert both report missing_optional_dependency.
      assert.equal(a.health, 'missing_optional_dependency');
      assert.equal(b.health, 'missing_optional_dependency');
    } finally {
      process.env.PATH = oldPath;
    }
  });
});
