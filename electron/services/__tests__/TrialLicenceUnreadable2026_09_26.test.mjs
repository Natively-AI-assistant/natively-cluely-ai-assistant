// A licence file that exists but cannot be read THIS session (toaster policy
// Phase 0, review finding 2026-09-26).
//
// LicenseManager.isPremium() memoises a `false` when readStoredLicense()
// fails for a transient reason — a safeStorage decrypt failure, or on Windows
// a Gumroad/Dodo licence whose native module antivirus quarantined. Treating
// that as "unlicensed" would run the expiry wipe (made permanent by its
// marker) and raise the Trial ended card, whose only exit deletes the licence.
// For those two destructive decisions, a licence file on disk counts.
//
// Own process: the unreadable license.enc must exist before the bundle loads.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const handlers = new Map();
let sends = [];
let wipes = 0;
let cm;

before(() => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-licence-unreadable-'));
  // Not JSON after "decryption": readStoredLicense() returns null, so
  // isPremium() is false for the whole session — the file is still there.
  fs.writeFileSync(path.join(userData, 'license.enc'), 'not-a-licence-this-session');

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
});

test('an unreadable licence still protects the user: no card, no wipe', async () => {
  cm.setTrialToken('trial_tok_test', new Date(Date.now() - 60_000).toISOString(), new Date().toISOString());
  cm.setNativelyApiKey('__trial__');
  sends = []; wipes = 0;

  const local = await handlers.get('trial:get-local')({});

  assert.equal(local.showEndedCard, false, 'a licence file on disk must never be walled in');
  assert.equal(wipes, 0, 'nor lose its profile data');
});

test('no renderer route can wipe it either (trial:wipe-profile-data is gone, toaster policy Phase 4)', () => {
  assert.equal(handlers.get('trial:wipe-profile-data'), undefined);
  assert.equal(wipes, 0);
});
