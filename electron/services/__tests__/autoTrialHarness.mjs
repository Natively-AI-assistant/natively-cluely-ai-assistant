// Shared by the MeetingStartsTrial tests: loads the COMPILED ipcHandlers with a
// stand-in Electron, a stand-in hardware id and a fetch the test controls.
// Nothing here can reach /v1/trial/start for real: the server spends a
// machine's one trial row per hardware id, and it is not re-issued for a test.
//
// Not a test file itself (no `.test.` in the name), so the runner skips it.
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The build `npm test` makes. NATIVELY_TEST_IPC_BUNDLE points a local run at a
// bundle built elsewhere, so it need not overwrite a build another run is using.
const COMPILED = process.env.NATIVELY_TEST_IPC_BUNDLE || path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');

export const LIVE_TRIAL = () => ({
  ok: true,
  trial_token: 'trial_tok_test',
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  started_at: new Date().toISOString(),
  usage: { ai: 0, ai_tokens: 0, stt_seconds: 0, search: 0 },
  limits: { duration_ms: 1_800_000, ai_requests: 50, stt_minutes: 30, search_requests: 10 },
});

export function loadIpcHandlers(label) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  process.env.NATIVELY_TEST_USERDATA = userData;
  const handlers = new Map();
  const sends = [];
  const trialStartCalls = [];
  const state = { meetingActive: true, reply: async () => { throw new Error('no reply planned'); } };

  const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sends.push({ channel, data }) } };
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false,
      getVersion: () => '0.0.0-test', getName: () => 'natively',
      on: noop, once: noop, off: noop, removeAllListeners: noop,
      whenReady: () => Promise.resolve(), isReady: () => true,
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
  const fakeNative = new Proxy({ getHardwareId: () => `${label}-hwid` }, {
    get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : function nativeStub() {}),
  });
  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
    return origLoad.call(this, request, ...rest);
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/v1/trial/start')) {
      trialStartCalls.push(JSON.parse(init?.body ?? '{}'));
      const body = await state.reply();
      return { ok: body.__status ? body.__status < 400 : true, status: body.__status ?? 200, json: async () => body };
    }
    return { ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) };
  };

  const mod = require(COMPILED);
  const appState = {
    processingHelper: { getLLMHelper: () => new Proxy({}, { get: () => noop }) },
    sendModelChanged: noop,
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => null,
    getIntelligenceManager: () => new Proxy({}, { get: () => noop }),
    getIsMeetingActive: () => state.meetingActive,
  };
  // initializeIpcHandlers registers what these tests need long before it
  // reaches the app-lifecycle wiring at the end, which the stand-in cannot satisfy.
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  /** Wait until the automatic start has nothing left in flight. */
  const settle = async (ms = 8_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (appState.autoTrialSettled?.() !== false) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('automatic trial start did not settle');
  };

  return { handlers, sends, trialStartCalls, state, appState, settle };
}
