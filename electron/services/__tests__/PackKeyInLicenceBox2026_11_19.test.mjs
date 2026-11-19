// 2026-11-19. A Pro pack key pasted into the Pro licence box (license:activate)
// stored the pack licence but never saved the key for the AI, so the buyer,
// still on their own AI, stayed paywalled: a pack gives Pro only with the AI
// and speech-to-text on Natively API. Now a pack licence from that box saves
// the key as if pasted under AI Providers, and the pack switch runs. A plan
// key pasted there is left as before (licence only).
//
// Runs the real handlers from the compiled bundle (harness as in
// TrialEndsOnlyOnPurchaseOrByok2026_09_25.test.mjs); LicenseManager's server
// calls are replaced, and nothing reaches the network. No platform branches.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLE = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');
const HAVE_BUILD = fs.existsSync(BUNDLE);
const PACK_KEY = 'natively_sk_test_pack_0123456789';
const PLAN_KEY = 'natively_sk_test_plan_0123456789';

const handlers = new Map();
let cm;
let lm;
let licence = { isPremium: false };

before(() => {
  if (!HAVE_BUILD) return;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-key-licence-box-'));
  const win = { isDestroyed: () => false, webContents: { send: () => {} } };
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
  // Nothing reaches the real API.
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });

  const mod = require(BUNDLE);
  lm = require(path.join(ROOT, 'dist-electron/premium/electron/services/LicenseManager.js')).LicenseManager.getInstance();
  lm.activateLicense = async () => ({ success: true });
  lm.activateWithApiKey = async () => ({ success: true });
  lm.getLicenseDetails = () => licence;
  const appState = {
    processingHelper: {
      getLLMHelper: () => ({
        setModel: noop, setNativelyKey: noop, getCodexCliConfig: () => ({ enabled: false }),
        getCurrentModelId: () => 'gpt-5', setGroqFastTextMode: noop,
      }),
    },
    sendModelChanged: noop,
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => null,
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }
  cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js')).CredentialsManager.getInstance();
});

beforeEach(() => {
  if (!HAVE_BUILD) return;
  cm.setNativelyPackApiKey?.(null);
  cm.setNativelyApiKey('');
});

test('a pack key pasted into the licence box is saved as the Natively key', { skip: !HAVE_BUILD && 'build:electron not run' }, async () => {
  licence = { isPremium: true, provider: 'natively_api', plan: 'pack_light' };
  const res = await handlers.get('license:activate')({}, `  ${PACK_KEY} `);
  assert.equal(res.success, true);
  const saved = [cm.getMainNativelyApiKey(), cm.getNativelyPackApiKey()];
  assert.ok(saved.includes(PACK_KEY), 'the pack key is stored for the AI');
});

test('a plan key pasted there stays licence only, as before', { skip: !HAVE_BUILD && 'build:electron not run' }, async () => {
  licence = { isPremium: true, provider: 'natively_api', plan: 'pro_monthly' };
  const res = await handlers.get('license:activate')({}, PLAN_KEY);
  assert.equal(res.success, true);
  assert.equal(cm.getMainNativelyApiKey(), undefined);
  assert.equal(cm.getNativelyPackApiKey(), undefined);
});

test('a refused activation saves nothing', { skip: !HAVE_BUILD && 'build:electron not run' }, async () => {
  licence = { isPremium: true, provider: 'natively_api', plan: 'pack_heavy' };
  const was = lm.activateLicense;
  lm.activateLicense = async () => ({ success: false, error: 'invalid' });
  try {
    const res = await handlers.get('license:activate')({}, PACK_KEY);
    assert.equal(res.success, false);
    assert.equal(cm.getMainNativelyApiKey(), undefined);
  } finally { lm.activateLicense = was; }
});
