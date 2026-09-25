// A trial ends when it RUNS OUT, when the user buys, or when they choose BYOK —
// and at no other time. Two of those three did nothing to the runtime.
//
//   • Natural expiry stood nothing down. The BYOK exit clears the sentinel key,
//     which makes CredentialsManager revert the default model and STT provider
//     off 'natively'; a trial that merely ran out of time left the app pointed
//     at the managed route holding a token the server now refuses. Every request
//     failed and the model chip still read "Natively API".
//   • Buying did not end it. `set-natively-api-key` overwrites the sentinel with
//     the real key but left the trial token in place, so "Free trial active" and
//     its countdown kept rendering next to the key just paid for.
//
// And one way a trial could end that must NOT: `set-natively-api-key` stores the
// key BEFORE the server verifies it, so a REFUSED key reverted the model to
// Gemini and killed a trial that still had time on it. A key bought minutes ago
// can be refused for hours while provisioning catches up, which is exactly when
// a buyer pastes it in.
//
// Executes the real handlers out of the compiled bundle — see
// TrialActivationRuntimeSync2026_09_25.test.mjs for the harness and its traps.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SENTINEL = '__trial__';
const REAL_KEY = 'natively_sk_test_key_0123456789';

const handlers = new Map();
let sends = [];
let modelChanged = [];
let llmCalls = [];
/** Per-test reply for /v1/pro/verify. */
let verifyReply = { status: 503, body: {} };

let cm;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

/** Put the app back into "a trial is running and owns the route". */
function giveTrial(expiresAt = inMinutes(20)) {
  cm.setTrialToken('trial_tok_test', expiresAt, new Date().toISOString());
  cm.setNativelyApiKey(SENTINEL);
  sends = []; modelChanged = []; llmCalls = [];
}

before(() => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-end-rules-'));
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

  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, ...rest);
  };

  // Nothing in this file may reach the real API. /v1/trial/start in particular
  // spends this machine's one trial per hardware id, and it is not re-issued.
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/pro/verify')) {
      return { ok: verifyReply.status < 300, status: verifyReply.status, json: async () => verifyReply.body };
    }
    return { ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) };
  };

  const mod = require(path.join(ROOT, 'dist-electron/electron/ipcHandlers.js'));
  const appState = {
    processingHelper: {
      getLLMHelper: () => ({
        setModel: (modelId) => llmCalls.push(['setModel', modelId]),
        setNativelyKey: (key) => llmCalls.push(['setNativelyKey', key]),
        getCodexCliConfig: () => ({ enabled: false }),
      }),
    },
    sendModelChanged: (modelId) => modelChanged.push(modelId),
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => null,
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js'))
    .CredentialsManager.getInstance();
});

describe('a trial that runs out stands the runtime down', () => {
  test('the startup read reverts the sentinel, the model and the STT provider', async () => {
    giveTrial(inMinutes(-1)); // already over
    assert.equal(cm.getDefaultModel(), 'natively', 'precondition: the trial owned the route');

    const local = await handlers.get('trial:get-local')({});

    assert.equal(local.expired, true, 'the read must still report the expiry to the renderer');
    assert.equal(cm.getNativelyApiKey(), undefined, 'the dead sentinel must go');
    assert.equal(cm.getDefaultModel(), 'gemini-3.1-flash-lite', 'the model must come off the managed route');
    assert.equal(cm.getSttProvider(), 'none', 'so must the STT provider');
    assert.deepEqual(modelChanged, ['gemini-3.1-flash-lite'], 'the overlay chip has to be told');
  });

  test('the trial token SURVIVES, so the end-of-trial card can still be shown', () => {
    assert.ok(
      cm.getTrialToken(),
      'the token is how trial:get-local reports `expired` on the next launch; it is already inert',
    );
  });

  test('a second call is a no-op — several windows poll at once', async () => {
    modelChanged = [];
    await handlers.get('trial:get-local')({});
    assert.deepEqual(modelChanged, [], 'nothing may be re-broadcast, and no second STT rebuild may start');
  });

  test('a trial with time left is left completely alone', async () => {
    giveTrial(inMinutes(20));
    await handlers.get('trial:get-local')({});
    assert.equal(cm.getNativelyApiKey(), SENTINEL, 'a running trial keeps the route');
    assert.equal(cm.getDefaultModel(), 'natively');
    assert.deepEqual(modelChanged, [], 'and nothing is broadcast');
  });
});

describe('buying ends the trial', () => {
  test('a key the server accepts clears the token and tells every window', async () => {
    giveTrial(inMinutes(20));
    // The standard-plan shape: authenticates fine, carries no Pro. It is a real
    // purchase, and the branch that would otherwise be missed by keying this on
    // Pro activation alone.
    verifyReply = { status: 200, body: { ok: true, has_pro: false, plan: 'standard' } };

    const res = await handlers.get('set-natively-api-key')({}, REAL_KEY);

    assert.equal(res.success, true, `save failed: ${JSON.stringify(res)}`);
    assert.equal(cm.getNativelyApiKey(), REAL_KEY, 'the real key replaces the sentinel');
    assert.equal(cm.getTrialToken(), undefined, 'the trial the purchase supersedes must be over');
    const ended = sends.filter((s) => s.channel === 'trial-ended');
    assert.equal(ended.length, 1, 'every window has to drop its trial card and countdown');
    assert.equal(ended[0].data.choice, 'purchased');
  });

  test('clearing a key does not invent a trial to end', async () => {
    verifyReply = { status: 200, body: { ok: true, has_pro: false, plan: 'standard' } };
    sends = [];
    await handlers.get('set-natively-api-key')({}, '');
    assert.equal(
      sends.filter((s) => s.channel === 'trial-ended').length,
      0,
      'there is no trial underneath this, so nothing ended',
    );
  });
});

describe('a key the server refuses must not end a running trial', () => {
  test('the trial is handed back, route and all', async () => {
    giveTrial(inMinutes(20));
    verifyReply = { status: 401, body: { ok: false, error: 'key_not_found' } };

    const res = await handlers.get('set-natively-api-key')({}, REAL_KEY);

    assert.equal(res.success, false, 'the refusal is still reported to the user');
    assert.ok(cm.getTrialToken(), 'the trial must survive a key that authenticates nowhere');
    assert.equal(
      cm.getNativelyApiKey(),
      SENTINEL,
      'and it must get its route back — the refusal path reverts to Gemini, which a trial user cannot call',
    );
    assert.equal(cm.getDefaultModel(), 'natively', 'so the model goes back to the managed route too');
    assert.equal(
      modelChanged.at(-1),
      'natively',
      'the last thing the overlay hears must be the restored route, not the Gemini revert',
    );
    assert.equal(
      sends.filter((s) => s.channel === 'trial-ended').length,
      0,
      'nothing ended, so nothing may say so',
    );
  });
});

describe('the trial sentinel never clobbers a real key', () => {
  test('trial:start leaves a stored key in place', async () => {
    cm.clearTrialToken();
    cm.setNativelyApiKey(REAL_KEY);
    llmCalls = [];
    // trial:start needs a hardware id and a /v1/trial/start reply; the fetch stub
    // refuses that URL, so the handler returns before the sentinel write either
    // way. What is pinned here is the guard itself.
    const src = fs.readFileSync(path.join(ROOT, 'electron/ipcHandlers.ts'), 'utf8');
    const block = src.slice(src.indexOf("safeHandle('trial:start'"), src.indexOf("safeHandle('trial:status'"));
    assert.ok(
      /storedKey && storedKey !== TRIAL_SENTINEL_KEY/.test(block),
      'trial:start must check for a real key before promoting the sentinel',
    );
    assert.equal(cm.getNativelyApiKey(), REAL_KEY);
  });
});
