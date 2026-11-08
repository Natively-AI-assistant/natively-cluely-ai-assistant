// A free trial ends when its AI allowance does (2026-11-03).
//
// A trial's 60,000 AI tokens ran out after eight or nine meeting answers,
// about eleven minutes before its clock. The server refused every question
// after that while the overlay counted down, and the answer failed as "check
// your API keys". Now the refusal (LLMHelper → nativelyPlanLimitEvents) ends
// the trial in main at once: the runtime stands down as at 30 minutes, the
// stored expiry becomes now, and every window hears trial-ended
// { choice: 'allowance' } with whether the Trial ended card is due.
//
// Executes the real handlers out of the compiled bundle — harness from
// TrialSupersededByPurchase2026_09_26.test.mjs (unlicensed process).
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
let statusCalls = 0;
let cm;
let sm;
let bus;

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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-allowance-'));
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
  bus = require(path.join(ROOT, 'dist-electron/electron/llm/nativelyPlanLimitEvents.js'));
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

const settle = () => new Promise((r) => setTimeout(r, 20));
const allowance = () => sends.filter((s) => s.channel === 'trial-ended' && s.data?.choice === 'allowance');

describe("the trial's AI allowance runs out", () => {
  test('a live trial ends now: runtime down, expiry now, every window told, card due', async () => {
    const startedAt = new Date(Date.now() - 19 * 60_000).toISOString();
    giveTrial(inMinutes(11), startedAt);

    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();

    assert.notEqual(cm.getNativelyApiKey(), SENTINEL, 'the trial route is stood down');
    assert.ok(cm.getTrialToken(), 'the token stays, so the next launch still shows the card');
    assert.ok(Date.parse(cm.getTrialExpiresAt()) <= Date.now(), 'the stored expiry is now');
    assert.equal(cm.getTrialStartedAt(), startedAt, 'the trial keeps its identity');
    const told = allowance();
    assert.equal(told.length, 1, 'every window hears it once');
    assert.equal(told[0].data.showEndedCard, true, 'nothing replaced the trial: the user must choose');
    assert.equal(told[0].data.expiresAt, cm.getTrialExpiresAt());
  });

  test('a second refusal already in flight changes nothing', async () => {
    giveTrial(inMinutes(11));
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();
    assert.equal(allowance().length, 1);
  });

  test('the status poll then agrees it is over, without asking the server, whose clock says not yet', async () => {
    giveTrial(inMinutes(11));
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();
    statusCalls = 0;
    statusReply = { status: 200, body: { ok: true, expired: false, expires_at: inMinutes(11) } };

    const res = await handlers.get('trial:status')({});

    assert.equal(res.ok, true);
    assert.equal(res.expired, true, 'the countdown must not come back');
    assert.equal(res.showEndedCard, true);
    assert.equal(statusCalls, 0);

    const local = await handlers.get('trial:get-local')({});
    assert.equal(local.expired, true, 'and so does the next launch');
  });
});

describe('what does not end the trial', () => {
  test('another allowance, or a paid key\'s limit', async () => {
    for (const limit of [
      { code: 'search_quota_exceeded', onTrial: true },
      { code: 'embedding_quota_exceeded', onTrial: true },
      { code: 'ai_quota_exceeded', onTrial: false },
    ]) {
      giveTrial(inMinutes(11));
      bus.emitNativelyPlanLimit(limit);
      await settle();
      assert.equal(cm.getNativelyApiKey(), SENTINEL, JSON.stringify(limit));
      assert.ok(Date.parse(cm.getTrialExpiresAt()) > Date.now(), JSON.stringify(limit));
      assert.equal(allowance().length, 0, JSON.stringify(limit));
    }
  });

  test('a real Natively key that has replaced the trial keeps its own route', async () => {
    giveTrial(inMinutes(11));
    cm.setNativelyApiKey(REAL_KEY);
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();
    assert.equal(cm.getNativelyApiKey(), REAL_KEY);
    assert.equal(allowance().length, 0);
    cm.setNativelyApiKey('');
  });

  test('a trial whose clock already ran out is left to the expiry flow', async () => {
    giveTrial(inMinutes(-1));
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();
    assert.equal(allowance().length, 0);
  });
});

describe('an own AI key supersedes the ended trial', () => {
  test('the token goes and windows hear "superseded", not the card', async () => {
    giveTrial(inMinutes(11));
    cm.setGeminiApiKey('AIza_test_key');
    bus.emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true });
    await settle();
    assert.equal(cm.getTrialToken(), undefined);
    assert.equal(allowance().length, 0);
    assert.ok(ended().some((s) => s.data?.choice === 'superseded'));
    cm.setGeminiApiKey('');
  });
});
