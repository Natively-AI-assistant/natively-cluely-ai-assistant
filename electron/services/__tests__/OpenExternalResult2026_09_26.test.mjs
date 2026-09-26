// open-external answers whether the page actually opened (toaster policy
// Phase 3, spec §6 row 9: "Store link fails to open: say so, with the link to
// copy"). It used to swallow every failure and answer nothing, so the browser
// extension card recorded "acted" for a store that never opened.
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test electron/services/__tests__/OpenExternalResult2026_09_26.test.mjs
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
let userData;
let shellFails = false;
const opened = [];

before(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'open-external-'));
  // The review ledger main imports from (ReviewService's review-state.json).
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
    dialog: {}, desktopCapturer: {}, systemPreferences: {},
    shell: { openExternal: async (url) => { if (shellFails) throw new Error('no handler for this URL'); opened.push(url); } },
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
    sendModelChanged: noop, reconfigureSttProvider: async () => {}, getKnowledgeOrchestrator: () => null,
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }
});


const open = (url) => handlers.get('open-external')({}, url);
const STORE = 'https://chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln';

test('an https page that opens answers ok', async () => {
  shellFails = false;
  assert.deepEqual(await open(STORE), { ok: true });
  assert.equal(opened.at(-1), STORE);
});

test('the system refusing to open it answers not ok', async () => {
  shellFails = true;
  try { assert.deepEqual(await open(STORE), { ok: false }); } finally { shellFails = false; }
});

test('a blocked protocol, a bad URL and a non-string answer not ok', async () => {
  assert.deepEqual(await open('http://example.com'), { ok: false });
  assert.deepEqual(await open('not a url'), { ok: false });
  assert.deepEqual(await open(42), { ok: false });
});
