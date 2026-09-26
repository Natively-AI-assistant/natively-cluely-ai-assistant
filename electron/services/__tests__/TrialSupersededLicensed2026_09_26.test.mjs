// A LICENSED user with an expired trial token (toaster policy Phase 0).
//
// The lock-in: someone let the trial run out, then bought Pro. Every launch
// wiped their résumé/JD data and opened the "Trial ended" card, which cannot
// be closed and whose only exit deactivates the licence. A licence supersedes
// the trial: the token is cleared, the card never shows, and nothing is wiped.
//
// Its own process: LicenseManager memoises isPremium(), so the licence file is
// written BEFORE the bundle loads and the whole file runs licensed.
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

const handlers = new Map();
let sends = [];
let wipes = 0;
let cm;
let sm;

const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString();
function giveTrial(expiresAt) {
  cm.setTrialToken('trial_tok_test', expiresAt, new Date().toISOString());
  cm.setNativelyApiKey(SENTINEL);
  sends = []; wipes = 0;
}
const ended = () => sends.filter((s) => s.channel === 'trial-ended');

before(() => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-licensed-'));
  // natively_api licences are server-validated, not HWID-bound, so no native
  // module is needed for readStoredLicense() to accept this one. The fake
  // safeStorage below "encrypts" as plain UTF-8.
  fs.writeFileSync(path.join(userData, 'license.enc'), JSON.stringify({
    key: 'natively_sk_licence_test', hwid: '', activatedAt: new Date().toISOString(),
    provider: 'natively_api', plan: 'pro',
  }));

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
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });

  const mod = require(path.join(ROOT, 'dist-electron/electron/ipcHandlers.js'));
  const appState = {
    processingHelper: { getLLMHelper: () => ({ setModel: noop, setNativelyKey: noop, getCodexCliConfig: () => ({ enabled: false }) }) },
    sendModelChanged: noop,
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => ({ setKnowledgeMode: () => { wipes += 1; }, deleteDocumentsByType: noop }),
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js')).CredentialsManager.getInstance();
  sm = require(path.join(ROOT, 'dist-electron/electron/services/SettingsManager.js')).SettingsManager.getInstance();
});

describe('a licensed user whose old trial expired', () => {
  test('never sees the Trial ended card, and the dead token is cleared', async () => {
    giveTrial(inMinutes(-1));
    const local = await handlers.get('trial:get-local')({});
    assert.equal(local.showEndedCard, false, 'a paying user must never be walled in');
    assert.equal(cm.getTrialToken(), undefined);
    assert.equal(ended().length, 1);
    assert.equal(ended()[0].data.choice, 'superseded');
  });

  test('loses no profile data to the expiry wipe', () => {
    assert.equal(wipes, 0, 'the expiry wipe must not run for a licensed user');
    assert.equal(sm.get('trialExpiryWipedFor'), undefined);
  });

  test('the wipe IPC refuses outright for a licensed user', async () => {
    const res = await handlers.get('trial:wipe-profile-data')({});
    assert.deepEqual(res, { success: false, error: 'licensed' });
    assert.equal(wipes, 0);
  });
});

describe('a licence bought during a running trial', () => {
  test('leaves the trial running: the licence is the Pro app, not AI access', async () => {
    giveTrial(inMinutes(20));
    const local = await handlers.get('trial:get-local')({});
    assert.equal(local.expired, false);
    assert.ok(cm.getTrialToken(), 'the running trial keeps its token');
    assert.equal(ended().length, 0);
  });
});
