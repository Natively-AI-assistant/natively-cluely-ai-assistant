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

// ── Search follows a Natively key (2026-11-19) ──────────────────────────────
// With a plan or pack key, Natively API search first, the user's Tavily key
// the fallback. Without one (or on the trial), Tavily first, as before.
test('search: a Natively key searches on Natively API even with a Tavily key; no key, Tavily', { skip: !HAVE_BUILD && 'build:electron not run' }, () => {
  const { resolveCompanySearchProvider } = require(path.join(ROOT, 'dist-electron/electron/services/resolveCompanySearchProvider.js'));
  cm.setTavilyApiKey('tvly-test-0123456789');
  try {
    cm.setNativelyApiKey('');
    assert.equal(resolveCompanySearchProvider()?.constructor?.name, 'TavilySearchProvider');
    cm.setNativelyApiKey(PLAN_KEY);
    assert.equal(resolveCompanySearchProvider()?.constructor?.name, 'NativelySearchProvider');
  } finally {
    cm.setTavilyApiKey('');
    cm.setNativelyApiKey('');
  }
});

test('search: research run out on Natively API, the Tavily key is asked', { skip: !HAVE_BUILD && 'build:electron not run' }, async () => {
  const { resolveCompanySearchProvider } = require(path.join(ROOT, 'dist-electron/electron/services/resolveCompanySearchProvider.js'));
  const asked = [];
  // The Tavily SDK is bundled with its own HTTP client (axios over node:https):
  // its request is seen and failed here, so nothing reaches the network.
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const httpsRequest = https.request;
  https.request = function fakeRequest(opts) {
    const host = typeof opts === 'string' ? new URL(opts).hostname : (opts?.hostname || opts?.host || String(opts?.href || ''));
    asked.push(String(host).includes('tavily') ? 'tavily' : String(host));
    const req = new EventEmitter();
    req.write = () => true;
    req.setTimeout = () => req;
    req.destroy = () => req;
    req.abort = () => {};
    req.end = () => { process.nextTick(() => req.emit('error', Object.assign(new Error('blocked in test'), { code: 'ECONNREFUSED' }))); };
    return req;
  };
  const was = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v1/search')) { asked.push('natively'); return { ok: false, status: 429, json: async () => ({ error: 'quota' }) }; }
    return { ok: false, status: 503, json: async () => ({}) };
  };
  cm.setTavilyApiKey('tvly-test-0123456789');
  cm.setNativelyApiKey(PLAN_KEY);
  try {
    await resolveCompanySearchProvider().search('acme', 3);
    assert.deepEqual(asked.filter((a) => a === 'natively' || a === 'tavily').slice(0, 2), ['natively', 'tavily']);
  } finally {
    https.request = httpsRequest;
    globalThis.fetch = was;
    cm.setTavilyApiKey('');
    cm.setNativelyApiKey('');
  }
});

test('an accepted key entry runs the Natively switch as entered; a pack key that cannot be saved puts the old licence back', () => {
  const src = fs.readFileSync(path.join(ROOT, 'electron/ipcHandlers.ts'), 'utf8');
  assert.match(src, /if \(apiKey && !keyRejection\) reconcilePackSwitchNow\(\{ entered: true \}\);/);
  const box = src.slice(src.indexOf("safeHandle('license:activate'"), src.indexOf("safeHandle('license:check-premium'"));
  assert.match(box, /await Promise\.resolve\(lm\.activateWithApiKey\(keyBefore\)\)/);
  assert.match(box, /result = \{ success: false, error: saved\?\.error/);
  assert.match(box, /win\.webContents\.send\('license-status-changed', \{ isPremium: isPremiumNow \}\)/);
});
