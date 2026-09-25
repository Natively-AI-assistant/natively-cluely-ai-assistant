// Starting a free trial must move the RUNTIME, not just the credentials file.
//
// `trial:start` writes the trial sentinel through CredentialsManager, which
// auto-promotes the stored default model to 'natively'. That was the whole of
// it — and it left two things behind until the next launch:
//
//   1. LLMHelper still held the PREVIOUS model id. On a fresh install that is
//      gemini-3.1-flash-lite, a provider the trial user has no key for, so the
//      trial's requests kept routing there while the stored default said
//      'natively'. A routing bug, not a cosmetic one.
//   2. Nothing told the renderers. The overlay's model chip reads
//      'model-changed' and the settings panels read 'credentials-changed', so
//      the meeting overlay kept naming Gemini for the entire trial, and the
//      launcher — which learned about a trial only by reading the local token
//      ON MOUNT — kept showing the Pro gate on the Modes and Profile
//      Intelligence managers.
//
// `set-natively-api-key` has always done this sync. The trial deliberately does
// NOT go through that handler (its Pro auto-activation would send the sentinel
// to the server, have it refused, and revert the promotion), so it needs its
// own call — which is what this file pins.
//
// This EXECUTES the real handler out of the compiled bundle rather than reading
// the source: the bug being fixed was a missing dispatch, and a source-level
// assertion cannot tell a call that runs from one that is never reached.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');

const TRIAL_PAYLOAD = {
  ok: true,
  trial_token: 'trial_tok_test',
  expires_at: '2026-09-25T12:00:00Z',
  started_at: '2026-09-25T11:30:00Z',
  usage: { ai: 0, ai_tokens: 0, stt_seconds: 0, search: 0 },
  limits: { duration_ms: 1_800_000, ai_requests: 50, stt_minutes: 30, search_requests: 10 },
};

const handlers = new Map();
const sends = [];
const llmCalls = [];
const modelChanged = [];

let credentials;
let startResult;

before(() => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-runtime-sync-'));
  const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sends.push({ channel, data }) } };
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false,
      getVersion: () => '0.0.0-test', getName: () => 'natively',
      on: noop, once: noop, off: noop, removeAllListeners: noop,
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [win] }),
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      handleOnce: (channel, fn) => handlers.set(channel, fn),
      on: noop, once: noop, off: noop,
      removeHandler: noop, removeListener: noop, removeAllListeners: noop,
      listenerCount: () => 0, emit: noop,
    },
    dialog: {}, desktopCapturer: {}, shell: {}, systemPreferences: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => Buffer.from(b).toString('utf8'),
      getSelectedStorageBackend: () => 'basic_text',
    },
    nativeTheme: { on: noop }, screen: { on: noop },
    session: {}, globalShortcut: {}, Menu: {}, Tray: {}, clipboard: {},
  };

  // trial:start binds the trial to getHardwareId() from the Rust native module
  // and refuses without one (fail-closed, F-601). This file is about what
  // happens AFTER a trial starts, so it supplies a stand-in module rather than
  // needing the native build (Build Smoke's macOS leg does not build it). Every
  // other export is a no-op function, which is all the loader's validation and
  // the module-load-time wiring need.
  const fakeNative = new Proxy({ getHardwareId: () => 'trial-runtime-sync-test-hwid' }, {
    get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : function nativeStub() {}),
  });
  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
    return origLoad.call(this, request, ...rest);
  };

  // Stubbed BEFORE the module is loaded: nothing in this file may reach
  // /v1/trial/start for real. The server spends this machine's one trial row
  // per hardware id, and it is not re-issued for a test run.
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v1/trial/start')) {
      return { ok: true, status: 200, json: async () => TRIAL_PAYLOAD };
    }
    return { ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) };
  };

  const mod = require(COMPILED);
  const appState = {
    processingHelper: {
      getLLMHelper: () => ({
        setModel: (modelId) => llmCalls.push(['setModel', modelId]),
        setNativelyKey: (key) => llmCalls.push(['setNativelyKey', key]),
      }),
    },
    sendModelChanged: (modelId) => modelChanged.push(modelId),
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => null,
  };
  // initializeIpcHandlers registers what this file needs long before it reaches
  // the app-lifecycle wiring at the end, which the stub above cannot satisfy.
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  credentials = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js'))
    .CredentialsManager.getInstance();
});

// The handler runs ONCE, here, and every test below reads what it did. Run per
// test it would re-enter trial:start and the send/call logs would accumulate.
before(async () => {
  assert.ok(handlers.has('trial:start'), 'trial:start must be registered');
  startResult = await handlers.get('trial:start')({});
});

/**
 * Fails with the REAL cause before any downstream assertion can fail with a
 * misleading one. `trial:start` refuses outright when it cannot read a hardware
 * id, which needs the premium native module — absent on a runner that skipped
 * the native build, and then all five assertions below would read as "the fix
 * is missing" rather than "the module is missing".
 */
function requireStarted() {
  if (startResult?.error === 'hardware_id_unavailable') {
    assert.fail(
      'trial:start refused: hardware_id_unavailable — the premium native module did not load in this runner, '
      + 'so this file could not exercise the handler at all. Not a failure of the code under test.',
    );
  }
  assert.equal(startResult?.ok, true, `trial:start failed: ${JSON.stringify(startResult)}`);
}

describe('trial:start moves the runtime onto Natively, not just the credentials file', () => {
  test('the handler ran and the stored default was promoted', () => {
    requireStarted();
    assert.equal(
      credentials.getDefaultModel(),
      'natively',
      'precondition: CredentialsManager auto-promotes the stored default when the sentinel is written',
    );
  });

  test('LLMHelper is moved off the old model — otherwise the trial routes to Gemini', () => {
    requireStarted();
    assert.deepEqual(
      llmCalls.find(([fn]) => fn === 'setNativelyKey'),
      ['setNativelyKey', '__trial__'],
      'the trial sentinel must reach LLMHelper',
    );
    assert.deepEqual(
      llmCalls.find(([fn]) => fn === 'setModel'),
      ['setModel', 'natively'],
      'without this LLMHelper keeps routing to the pre-trial model (gemini-3.1-flash-lite on a fresh install)',
    );
  });

  test("the overlay is told, so the model chip stops reading 'Gemini 3.1 Flash Lite'", () => {
    requireStarted();
    assert.deepEqual(
      modelChanged,
      ['natively'],
      "sendModelChanged drives the overlay's model chip; without it the chip names the pre-trial model all trial long",
    );
  });

  test('a trial-started broadcast reaches the windows', () => {
    requireStarted();
    const started = sends.filter((s) => s.channel === 'trial-started');
    assert.equal(started.length, 1, 'exactly one trial-started event per start');
    assert.equal(started[0].data.expiresAt, TRIAL_PAYLOAD.expires_at);
    assert.equal(started[0].data.startedAt, TRIAL_PAYLOAD.started_at);
    assert.deepEqual(started[0].data.limits, TRIAL_PAYLOAD.limits);
  });

  test('credentials-changed is broadcast so the settings panels re-read', () => {
    requireStarted();
    assert.ok(
      sends.some((s) => s.channel === 'credentials-changed'),
      'the STT dropdown and provider cards re-read credentials only on this event',
    );
  });
});
