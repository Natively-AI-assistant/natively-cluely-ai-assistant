// An expired trial token is SUPERSEDED by a real Natively key or an own AI key
// (toaster policy Phase 0, docs/superpowers/specs/2026-09-26-toaster-policy-design.md).
//
// Before: the token survived a purchase, so every launch wiped the user's
// résumé/JD data and opened the "Trial ended" card, which cannot be closed.
// After: main settles an expired token in one place (settleExpiredTrial) —
// clears it once something supersedes the trial, shows the card only when
// nothing does, and runs the profile wipe once per trial.
//
// This file runs UNLICENSED (no license.enc). The licensed half is
// TrialSupersededLicensed2026_09_26.test.mjs, in its own process because
// LicenseManager memoises isPremium().
//
// Executes the real handlers out of the compiled bundle — harness from
// TrialEndsOnlyOnPurchaseOrByok2026_09_25.test.mjs.
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
let verifyReply = { status: 503, body: {} };
let statusReply = { status: 503, body: {} };
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-superseded-'));
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
    reconfigureSttProvider: async () => {},
    // The wipe's first act is switching knowledge mode off; count wipes there.
    getKnowledgeOrchestrator: () => ({
      setKnowledgeMode: () => { wipes += 1; },
      deleteDocumentsByType: noop,
    }),
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js')).CredentialsManager.getInstance();
  sm = require(path.join(ROOT, 'dist-electron/electron/services/SettingsManager.js')).SettingsManager.getInstance();
});

describe('nothing supersedes the expired trial', () => {
  test('the card shows, the token stays, and the profile wipe runs once', async () => {
    const startedAt = new Date(Date.now() - 40 * 60_000).toISOString();
    giveTrial(inMinutes(-1), startedAt);

    const first = await handlers.get('trial:get-local')({});
    assert.equal(first.expired, true);
    assert.equal(first.showEndedCard, true, 'nothing replaced the trial, so the user must choose');
    assert.ok(cm.getTrialToken(), 'the token stays so the next launch shows the card again');
    assert.equal(wipes, 1, 'the expiry wipe runs in main, once');
    assert.equal(sm.get('trialExpiryWipedFor'), startedAt, 'and records which trial it wiped');

    await handlers.get('trial:get-local')({});
    await handlers.get('trial:get-local')({});
    assert.equal(wipes, 1, 'several windows and several launches: still one wipe');
    assert.equal(ended().length, 0, 'nothing was superseded, so nothing is ended');
  });

  test('a speech-to-text key is not an AI route: the card still shows', async () => {
    giveTrial(inMinutes(-1));
    cm.setDeepgramApiKey('dg_test_key');
    const local = await handlers.get('trial:get-local')({});
    assert.equal(local.showEndedCard, true);
    assert.ok(cm.getTrialToken());
    cm.setDeepgramApiKey('');
  });
});

describe('something supersedes the expired trial', () => {
  test('an own AI key: the dead token is cleared and every window is told', async () => {
    giveTrial(inMinutes(-1));
    cm.setGeminiApiKey('AIza_test_key');

    const local = await handlers.get('trial:get-local')({});

    assert.equal(local.showEndedCard, false, 'the user has an AI route; no card');
    assert.equal(local.hasToken, false);
    assert.equal(local.superseded, true);
    assert.equal(cm.getTrialToken(), undefined, 'the dead token must go');
    assert.equal(cm.getTrialClaimed(), true, 'but the trial stays claimed');
    assert.equal(ended().length, 1);
    assert.equal(ended()[0].data.choice, 'superseded');
  });

  test('a real Natively key saved after expiry clears the dead token', async () => {
    giveTrial(inMinutes(-1));
    verifyReply = { status: 200, body: { ok: true, has_pro: false, plan: 'standard' } };

    const res = await handlers.get('set-natively-api-key')({}, REAL_KEY);

    assert.equal(res.success, true, `save failed: ${JSON.stringify(res)}`);
    assert.equal(cm.getTrialToken(), undefined, 'a purchase after expiry must end the dead trial too');
    assert.ok(ended().length >= 1, 'an open Trial ended card has to close');
    cm.setNativelyApiKey('');
  });

  test('a key added while the card is open settles it at once', async () => {
    giveTrial(inMinutes(-1));
    cm.setGeminiApiKey('AIza_test_key');
    // Any credentials change broadcasts; this handler is the lightest one that does.
    const res = await handlers.get('set-disabled-providers')({}, []);
    assert.equal(res.success, true, `handler failed: ${JSON.stringify(res)}`);
    assert.equal(cm.getTrialToken(), undefined);
    assert.equal(ended().length, 1, 'the open card closes via trial-ended');
  });

  test('the status poll settles a server-side expiry too', async () => {
    giveTrial(inMinutes(20)); // the local clock still says running
    cm.setGeminiApiKey('AIza_test_key');
    statusReply = { status: 200, body: { ok: true, expired: true } };

    const res = await handlers.get('trial:status')({});

    assert.equal(res.expired, true);
    assert.equal(res.showEndedCard, false);
    assert.equal(cm.getTrialToken(), undefined);
  });
});

describe('a trial with time left is never touched', () => {
  test('own AI key or not, the running trial keeps its token', async () => {
    giveTrial(inMinutes(20));
    cm.setGeminiApiKey('AIza_test_key');
    const local = await handlers.get('trial:get-local')({});
    assert.equal(local.expired, false);
    assert.equal(local.hasToken, true);
    assert.ok(cm.getTrialToken());
    assert.equal(wipes, 0);
    assert.equal(ended().length, 0);
  });
});
