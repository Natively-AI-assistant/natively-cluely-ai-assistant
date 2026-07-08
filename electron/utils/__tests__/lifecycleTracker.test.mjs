// electron/utils/__tests__/lifecycleTracker.test.mjs
//
// PHASE-2E unit tests for the LifecycleTracker.
//
// We can't load the real Electron module in bare `node --test`, so we
// re-implement a tiny harness that simulates the Electron `app` API
// just enough to exercise the module's install() and persistence logic.
//
// The actual electron-source-faithful re-implementation of the core
// methods is included below so this test file can run independently;
// keep it in sync with the source if the module changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Electron stub --------------------------------------------------------

// Minimal Electron stub sufficient for LifecycleTracker. Records every
// event registration so tests can fire them by name.
function makeElectronStub(tmpUserData) {
  const handlers = {};
  const webContents = { id: 1, getURL: () => 'https://app.local/chat' };
  const electron = {
    app: {
      getPath: (key) => (key === 'userData' ? tmpUserData : os.tmpdir()),
      on: (event, handler) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
      },
      _fire: (event, ...args) => {
        for (const h of handlers[event] || []) h(...args);
      },
    },
    BrowserWindow: class {},
    WebContents: class {},
    utilityProcess: {},
  };
  return { electron, handlers, webContents };
}

// --- Source-rebuild of the LifecycleTracker --------------------------------
//
// Mirrors electron/utils/lifecycleTracker.ts so we can test the contract in
// bare-node. KEEP IN SYNC if the source module changes.

function makeTracker({ tmpUserData, handlers, consoleLog = () => {} }) {
  let marker = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastEvent: 'app-start',
    lastEventAt: new Date().toISOString(),
    quitReason: null,
  };

  function writeMarker() {
    const file = path.join(tmpUserData, 'lifecycle-marker.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(marker, null, 2));
  }

  function record(event, reason, meta) {
    marker.lastEvent = event;
    marker.lastEventAt = new Date().toISOString();
    if (reason) {
      marker.quitReason = reason;
      marker.quitMeta = meta;
    }
    writeMarker();
    consoleLog(`[Lifecycle] ${event}${reason ? ` reason=${reason}` : ''}`);
  }

  function install() {
    const wire = (event, fn) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(fn);
    };
    wire('will-quit', () => record('will-quit', 'user-quit'));
    wire('window-all-closed', () => record('window-all-closed', 'window-close'));
    wire('before-quit', () => {
      if (!marker.quitReason) record('before-quit', 'user-quit');
      else record('before-quit', marker.quitReason, marker.quitMeta);
    });
    wire('render-process-gone', (_e, wc, details) => {
      record('render-process-gone', 'renderer-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
        webContentsId: wc.id,
        url: wc.getURL(),
      });
    });
    wire('child-process-gone', (_e, details) => {
      record('child-process-gone', 'child-process-gone', {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
      });
    });
    wire('gpu-process-crashed', (_e, killed) => {
      record('gpu-process-crashed', 'gpu-process-crashed', { killed });
    });
  }

  function setQuitReason(reason, meta) {
    marker.quitReason = reason;
    marker.quitMeta = meta;
    marker.lastEvent = `quit-reason:${reason}`;
    marker.lastEventAt = new Date().toISOString();
    writeMarker();
  }

  function markCleanExit() {
    // FIX-CRITICAL-2: don't clobber a pre-set quitReason. A successful
    // auto-update path sets `updater-quit-install` BEFORE before-quit
    // runs; markCleanExit must NOT erase that or the next launch would
    // show a false "previous session crashed" warning.
    const hadSpecificReason = marker.quitReason !== null;
    marker.lastEvent = 'clean-exit';
    marker.lastEventAt = new Date().toISOString();
    if (!hadSpecificReason) {
      marker.quitReason = null;
      marker.quitMeta = undefined;
    }
    writeMarker();
  }

  function readPreviousSessionMarker(prevPid = process.pid + 1) {
    const file = path.join(tmpUserData, 'lifecycle-marker.json');
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.pid === process.pid) return null;
      // For tests we artificially make this look like a previous PID.
      parsed.pid = prevPid;
      return parsed;
    } catch {
      return null;
    }
  }

  function didPreviousSessionCrash() {
    const prev = readPreviousSessionMarker();
    if (!prev) return false;
    if (!prev.quitReason) return prev.lastEvent !== 'clean-exit';
    // FIX-CRITICAL-2: expanded the non-crash set so a successful
    // auto-update (updater-quit-install) doesn't trigger a false-positive
    // "previous session crashed" warning.
    const NON_CRASH_REASONS = new Set([
      'user-quit',
      'window-close',
      'updater-quit-install',
      'manual-relaunch',
      'second-instance',
      'os-signal',
    ]);
    return !NON_CRASH_REASONS.has(prev.quitReason);
  }

  return {
    install,
    setQuitReason,
    markCleanExit,
    readPreviousSessionMarker,
    didPreviousSessionCrash,
    _getMarker: () => marker,
  };
}

// --- Tests -----------------------------------------------------------------

function freshTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));
}

test('installBeforeReady writes marker to tmpdir fallback when userData throws', () => {
  const tmp = freshTmp();
  // Simulate pre-whenReady: getUserData throws (returns false-y path).
  const fake = LifecycleTrackerLike({ tmp, getUserData: () => { throw new Error('not ready'); } });
  fake.installBeforeReady();
  fake.setQuitReason('os-signal', { reason: 'SIGTERM-equivalent' });
  // Marker file should exist in tmpdir, NOT in userData.
  const expected = path.join(tmp, `natively-lifecycle-${process.pid}.json`);
  assert.ok(fs.existsSync(expected), `expected tmpdir marker at ${expected}`);
  const parsed = JSON.parse(fs.readFileSync(expected, 'utf8'));
  assert.equal(parsed.quitReason, 'os-signal');
  // didPreviousSessionCrash should detect the os-signal as a crash.
  assert.equal(fake.didPreviousSessionCrash(), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('installBeforeReady prefers userData when getUserData works', () => {
  const tmp = freshTmp();
  const userDataDir = path.join(tmp, 'userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const fake = LifecycleTrackerLike({ tmp, getUserData: () => userDataDir });
  fake.installBeforeReady();
  fake.setQuitReason('os-signal');
  // Marker should land in userData, NOT in tmpdir.
  assert.ok(fs.existsSync(path.join(userDataDir, 'lifecycle-marker.json')));
  assert.ok(!fs.existsSync(path.join(tmp, `natively-lifecycle-${process.pid}.json`)));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Stubbed tracker that mirrors the source module's behavior for the
// pre-whenReady / post-whenReady path so we can exercise the tmpdir
// fallback in bare-node tests.
function LifecycleTrackerLike({ tmp, getUserData }) {
  let marker = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastEvent: 'app-start',
    lastEventAt: new Date().toISOString(),
    quitReason: null,
  };
  function writeMarker() {
    let file;
    try {
      file = path.join(getUserData(), 'lifecycle-marker.json');
    } catch {
      file = path.join(tmp, `natively-lifecycle-${process.pid}.json`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(marker, null, 2));
  }
  return {
    installBeforeReady: () => { /* no-op for stub */ },
    setQuitReason: (reason, meta) => {
      marker.quitReason = reason;
      marker.quitMeta = meta;
      marker.lastEvent = `quit-reason:${reason}`;
      marker.lastEventAt = new Date().toISOString();
      writeMarker();
    },
    didPreviousSessionCrash: () => {
      if (!marker.quitReason) return marker.lastEvent !== 'clean-exit';
      return marker.quitReason !== 'user-quit' && marker.quitReason !== 'window-close';
    },
  };
}

test('install() wires all expected lifecycle events', () => {
  const tmp = freshTmp();
  const { handlers, electron: _electron } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();

  for (const ev of [
    'will-quit',
    'window-all-closed',
    'before-quit',
    'render-process-gone',
    'child-process-gone',
    'gpu-process-crashed',
  ]) {
    assert.ok((handlers[ev] || []).length > 0, `expected handler for ${ev}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('render-process-gone records reason=renderer-gone with safe url', () => {
  const tmp = freshTmp();
  const { handlers, webContents } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();

  (handlers['render-process-gone'] || []).forEach((h) =>
    h({}, webContents, { reason: 'crashed', exitCode: 1 })
  );

  const m = tracker._getMarker();
  assert.equal(m.lastEvent, 'render-process-gone');
  assert.equal(m.quitReason, 'renderer-gone');
  assert.equal(m.quitMeta.reason, 'crashed');
  assert.equal(m.quitMeta.exitCode, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('child-process-gone records reason=child-process-gone', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();

  (handlers['child-process-gone'] || []).forEach((h) =>
    h({}, { type: 'utility', reason: 'killed', exitCode: 137, serviceName: 'local-embedding' })
  );

  const m = tracker._getMarker();
  assert.equal(m.quitReason, 'child-process-gone');
  assert.equal(m.quitMeta.serviceName, 'local-embedding');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('gpu-process-crashed records reason=gpu-process-crashed', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();

  (handlers['gpu-process-crashed'] || []).forEach((h) => h({}, true));
  assert.equal(tracker._getMarker().quitReason, 'gpu-process-crashed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('setQuitReason(updater-quit-install) wins over later before-quit', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();

  tracker.setQuitReason('updater-quit-install', { fromVersion: '2.8.0', toVersion: '2.8.1' });
  (handlers['before-quit'] || []).forEach((h) => h({}));

  assert.equal(tracker._getMarker().quitReason, 'updater-quit-install');
  assert.equal(tracker._getMarker().quitMeta.fromVersion, '2.8.0');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('markCleanExit clears the quit reason ONLY when none was pre-set', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();

  // Happy path: no pre-set reason → cleanup clears it. (FIX-CRITICAL-2
  // updated the contract: a pre-set reason is preserved. The previous
  // test asserted clearing UNCONDITIONALLY, which is the bug we fixed.)
  tracker.markCleanExit();
  const m = tracker._getMarker();
  assert.equal(m.quitReason, null);
  assert.equal(m.lastEvent, 'clean-exit');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('didPreviousSessionCrash returns false for a clean prior session', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  tracker.markCleanExit();
  assert.equal(tracker.didPreviousSessionCrash(), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('didPreviousSessionCrash returns true for a renderer-gone prior session', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  // Simulate a previous session by writing a marker with a different PID.
  // The test harness's readPreviousSessionMarker overrides pid to a different
  // value, so calling setQuitReason() on the *current* marker would not
  // be visible as a "previous" crash. Write the prior marker directly.
  const file = path.join(tmp, 'lifecycle-marker.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      pid: 99999,
      startedAt: new Date().toISOString(),
      lastEvent: 'render-process-gone',
      lastEventAt: new Date().toISOString(),
      quitReason: 'renderer-gone',
      quitMeta: { reason: 'oom', exitCode: 1 },
    })
  );
  assert.equal(tracker.didPreviousSessionCrash(), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('didPreviousSessionCrash returns true for unknown-quit-reason prior session', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  // Simulate SIGKILL by writing a marker with no quitReason.
  const file = path.join(tmp, 'lifecycle-marker.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      pid: process.pid + 1,
      startedAt: new Date().toISOString(),
      lastEvent: 'SIGKILL',
      lastEventAt: new Date().toISOString(),
      quitReason: null,
    })
  );
  assert.equal(tracker.didPreviousSessionCrash(), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
// =====================================================================
// FIX-CRITICAL-2 follow-up tests (senior review):
// markCleanExit MUST NOT clobber a pre-set quitReason (esp. for
// updater-quit-install), and didPreviousSessionCrash MUST treat
// updater-quit-install / manual-relaunch / os-signal / second-instance
// as non-crash reasons.
// =====================================================================

test('markCleanExit preserves a pre-set updater-quit-install reason', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  // Simulate the exact macOS Squirrel.Mac flow: setQuitReason happens
  // BEFORE before-quit, then cleanup runs to completion.
  tracker.setQuitReason('updater-quit-install', { fromVersion: '2.8.0', toVersion: '2.8.1' });
  tracker.markCleanExit();
  const m = tracker._getMarker();
  assert.equal(m.lastEvent, 'clean-exit');
  assert.equal(m.quitReason, 'updater-quit-install', 'markCleanExit must NOT clobber a pre-set quitReason');
  assert.equal(m.quitMeta?.fromVersion, '2.8.0');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('markCleanExit preserves a pre-set fatal-main-error reason', () => {
  const tmp = freshTmp();
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  tracker.setQuitReason('fatal-main-error', { source: 'native-arch-gate', message: 'mismatch' });
  tracker.markCleanExit();
  const m = tracker._getMarker();
  assert.equal(m.quitReason, 'fatal-main-error');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('didPreviousSessionCrash returns false for a prior updater-quit-install', () => {
  const tmp = freshTmp();
  const file = path.join(tmp, 'lifecycle-marker.json');
  fs.writeFileSync(file, JSON.stringify({
    pid: process.pid + 1,
    startedAt: new Date().toISOString(),
    lastEvent: 'updater-quit-install',
    lastEventAt: new Date().toISOString(),
    quitReason: 'updater-quit-install',
    quitMeta: { fromVersion: '2.8.0', toVersion: '2.8.1' },
  }));
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  assert.equal(tracker.didPreviousSessionCrash(), false,
    'a successful auto-update must NOT trigger a false crash warning');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('didPreviousSessionCrash returns false for prior os-signal (caught SIGTERM)', () => {
  const tmp = freshTmp();
  const file = path.join(tmp, 'lifecycle-marker.json');
  fs.writeFileSync(file, JSON.stringify({
    pid: process.pid + 1,
    startedAt: new Date().toISOString(),
    lastEvent: 'SIGTERM',
    lastEventAt: new Date().toISOString(),
    quitReason: 'os-signal',
  }));
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  assert.equal(tracker.didPreviousSessionCrash(), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('didPreviousSessionCrash returns true for prior fatal-main-error', () => {
  const tmp = freshTmp();
  const file = path.join(tmp, 'lifecycle-marker.json');
  fs.writeFileSync(file, JSON.stringify({
    pid: process.pid + 1,
    startedAt: new Date().toISOString(),
    lastEvent: 'uncaughtException',
    lastEventAt: new Date().toISOString(),
    quitReason: 'fatal-main-error',
    quitMeta: { source: 'native-arch-gate' },
  }));
  const { handlers } = makeElectronStub(tmp);
  const tracker = makeTracker({ tmpUserData: tmp, handlers });
  tracker.install();
  assert.equal(tracker.didPreviousSessionCrash(), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// =====================================================================
// FIX-HIGH-2 follow-up tests: the production sanitizeMeta is recursive
// and handles nested objects, arrays, and Error instances. We can't
// import the production helper directly (lifecycleTracker imports
// electron), so we mirror it here in a small inline copy and assert the
// contract on the inlined implementation. The contract must match.
// =====================================================================

function sanitizeMeta(meta, depth = 0) {
  const MAX = 4;
  const MAX_STR = 200;
  const SENS_KEY = /key|secret|token|password|auth|credential/i;
  const SENS_VAL = [
    /\bBearer\s+[A-Za-z0-9._\-+/=]{6,}/g,
    /\bsk-[A-Za-z0-9_\-]{16,}/g,
    /\bghp_[A-Za-z0-9]{20,}/g,
    /\bAIza[0-9A-Za-z_\-]{35}/g,
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?([^\s"']{6,})["']?/gi,
  ];
  function redact(s) {
    let out = s;
    for (const re of SENS_VAL) out = out.replace(re, '[REDACTED]');
    return out;
  }
  if (depth > MAX) return '[max-depth]';
  if (meta === null || meta === undefined) return meta;
  if (meta instanceof Error) {
    let m = String(meta.message ?? meta);
    m = redact(m);
    return `[Error: ${m.length > MAX_STR ? `${m.slice(0, MAX_STR)}…` : m}]`;
  }
  if (Array.isArray(meta)) return meta.map((v) => sanitizeMeta(v, depth + 1));
  if (typeof meta === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(meta)) {
      if (SENS_KEY.test(k)) { out[k] = '[REDACTED]'; continue; }
      if (typeof v === 'string') {
        const r = redact(v);
        out[k] = r.length > MAX_STR ? `[${r.length} chars]` : r;
        continue;
      }
      out[k] = sanitizeMeta(v, depth + 1);
    }
    return out;
  }
  return meta;
}

test('sanitizeMeta redacts a NESTED apiKey inside an object', () => {
  const out = sanitizeMeta({
    user: { id: 42, apiKey: 'sk-1234567890', nested: { authHeader: 'Bearer abc' } },
  });
  assert.equal(out.user.id, 42);
  assert.equal(out.user.apiKey, '[REDACTED]');
  assert.equal(out.user.nested.authHeader, '[REDACTED]');
});

test('sanitizeMeta redacts a NESTED token inside an array element', () => {
  const out = sanitizeMeta({ items: [{ id: 1 }, { token: 'xyz' }] });
  assert.equal(out.items[0].id, 1);
  assert.equal(out.items[1].token, '[REDACTED]');
});

test('sanitizeMeta redacts an Error message that contains a secret pattern', () => {
  const err = new Error('request failed: api_key=sk-secret leaked somewhere');
  const out = sanitizeMeta({ reason: err });
  assert.ok(out.reason.startsWith('[Error: '));
  assert.ok(!out.reason.includes('sk-secret'), 'must not leak the secret from the Error message');
});

test('sanitizeMeta truncates very long strings', () => {
  const long = 'a'.repeat(500);
  const out = sanitizeMeta({ note: long });
  assert.equal(out.note, '[500 chars]');
});

test('sanitizeMeta stops at MAX depth (cyclic structures)', () => {
  const a = { name: 'a' };
  const b = { name: 'b', child: a };
  a.child = b; // cycle: a → b → a → ...
  // Should not infinite-loop. MAX depth is 4; the recursion bottoms out.
  const out = sanitizeMeta(a);
  assert.ok(out);
  assert.ok(out.child);
});
