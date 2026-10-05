// The Trial ended card's wipe tells the truth (toaster policy Phase 3,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §5 rows 3, 5, 6).
//
// "Use my own API keys" (trial:end-byok) used to swallow every wipe step's
// error and report success, so a failed wipe showed "All set. Trial data is
// gone." It also broadcast trial-ended before replying, which unmounted the
// card mid-"Cleaning up". And the expiry wipe re-ran on every settle when the
// settings store could not persist its once-marker.
//
// Executes the REAL compiled handlers (dist-electron) behind a fake electron.
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test electron/services/__tests__/TrialEndByokHonest2026_09_26.test.mjs
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
let wipes = 0;
let wipeStepThrows = false;
let sttRejects = false;
let verifyReply = { status: 503, body: {} };
let statusReply = { status: 503, body: {} };
let statusCalls = 0;
let cm;
let sm;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

/** A trial whose route is still the sentinel, started `startedAt`. */
function giveTrial(expiresAt, startedAt = new Date().toISOString()) {
  cm.setGeminiApiKey('');
  cm.setTrialToken('trial_tok_test', expiresAt, startedAt);
  cm.setNativelyApiKey(SENTINEL);
  sends = []; wipes = 0;
}
const ended = () => sends.filter((s) => s.channel === 'trial-ended');

before(() => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-byok-honest-'));
  const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sends.push({ channel, data }) } };
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false, isReady: () => true,
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

  // Nothing here may reach the real API.
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/pro/verify')) {
      return { ok: verifyReply.status < 300, status: verifyReply.status, json: async () => verifyReply.body };
    }
    if (u.includes('/v1/trial/status')) {
      statusCalls += 1;
      return { ok: statusReply.status < 300, status: statusReply.status, json: async () => statusReply.body };
    }
    return { ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) };
  };

  const mod = require(path.join(ROOT, 'dist-electron/electron/ipcHandlers.js'));
  const llmHelper = {
    setModel: noop, setNativelyKey: noop, setApiKey: noop,
    getCodexCliConfig: () => ({ enabled: false }),
    getCurrentModel: () => 'gemini-3.1-flash-lite',
  };
  const appState = {
    processingHelper: { getLLMHelper: () => llmHelper },
    sendModelChanged: noop,
    reconfigureSttProvider: async () => { if (sttRejects) throw new Error('stt restart failed'); },
    // The wipe's first act is switching knowledge mode off; count wipes there.
    getKnowledgeOrchestrator: () => ({
      setKnowledgeMode: () => { wipes += 1; if (wipeStepThrows) throw new Error('disk full'); },
      deleteDocumentsByType: noop,
    }),
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js')).CredentialsManager.getInstance();
  sm = require(path.join(ROOT, 'dist-electron/electron/services/SettingsManager.js')).SettingsManager.getInstance();
});


const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

describe('trial:end-byok', () => {
  test('a wipe step that fails is reported, and the trial is left as it was', async () => {
    giveTrial(minutesAgo(1), minutesAgo(31));
    wipeStepThrows = true;
    try {
      const res = await handlers.get('trial:end-byok')({});
      assert.deepEqual(res, { success: false, error: 'wipe_failed' });
      assert.equal(cm.getTrialToken(), 'trial_tok_test', 'the token stays, so Try again can run');
      assert.equal(ended().length, 0, 'nothing announces an end that did not happen');
    } finally {
      wipeStepThrows = false;
    }
  });

  test('a clean wipe ends the trial and says so once', async () => {
    giveTrial(minutesAgo(1), minutesAgo(32));
    const res = await handlers.get('trial:end-byok')({});
    assert.deepEqual(res, { success: true, wipeIncomplete: false });
    assert.ok(!cm.getTrialToken(), 'the token is gone');
    assert.equal(ended().length, 1);
    assert.deepEqual(ended()[0].data, { choice: 'byok' });
  });
});

// Final review I2: a wipe that keeps failing (full disk, a locked database)
// must not wall the user in behind a card that cannot close. After a second
// failure the card offers "End trial anyway" (force), which ends the trial and
// says honestly that some data was left behind.
describe('trial:end-byok, forced after repeated failures', () => {
  test('ends the trial even though the wipe failed, and says so', async () => {
    giveTrial(minutesAgo(1), minutesAgo(34));
    wipeStepThrows = true;
    try {
      const res = await handlers.get('trial:end-byok')({}, { force: true });
      assert.deepEqual(res, { success: true, wipeIncomplete: true });
      assert.ok(!cm.getTrialToken(), 'the trial ended');
      assert.equal(ended().length, 1);
    } finally {
      wipeStepThrows = false;
    }
  });
});

// Final review minor #1 (re-graded: it completes the same trap): once the wipe
// has succeeded, a later step failing must not read as "the wipe failed".
describe('trial:end-byok, after a clean wipe', () => {
  test('a step after the wipe that throws does not undo the success', async () => {
    giveTrial(minutesAgo(1), minutesAgo(35));
    sttRejects = true;
    try {
      const res = await handlers.get('trial:end-byok')({});
      assert.deepEqual(res, { success: true, wipeIncomplete: false });
      assert.ok(!cm.getTrialToken());
      assert.equal(ended().length, 1);
    } finally {
      sttRejects = false;
    }
  });
});

describe('the expiry wipe runs once', () => {
  test('also when the settings store cannot keep the once-marker', async () => {
    giveTrial(minutesAgo(1), minutesAgo(33));
    const realSet = sm.set.bind(sm);
    sm.set = () => false; // a degraded store: nothing persists
    try {
      const first = await handlers.get('trial:get-local')({});
      assert.equal(first.showEndedCard, true, 'precondition: the card is due');
      await handlers.get('trial:get-local')({});
      await handlers.get('trial:get-local')({});
      assert.equal(wipes, 1, 'one wipe per trial, not one per settle');
    } finally {
      sm.set = realSet;
    }
  });
});
