// Saving a new Natively key must reach the EMBEDDER, not only chat and STT.
//
// NativelyEmbeddingProvider captures its key when it is built. Before this fix
// `set-natively-api-key` re-pointed LLMHelper, the model and STT, but never
// re-initialised RAGManager's EmbeddingPipeline. On 2026-11-16 an Ultra
// customer upgraded mid-meeting: the Pro key was cancelled, the Ultra key was
// pasted, chat moved to it — and /v1/embed kept sending the cancelled key and
// got 403 subscription_inactive once a minute for 80+ minutes, so meeting
// memory and reference-file retrieval stayed dark until a restart.
//
// Like TrialActivationRuntimeSync2026_09_25, this EXECUTES the real handler
// from the compiled bundle: the defect was a missing dispatch, which a source
// assertion cannot distinguish from one that is never reached. Platform-neutral
// (no process.platform branch is involved), so it runs the same on macOS and
// Windows runners.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');

const OLD_KEY = 'nat_' + 'a'.repeat(40);
const NEW_KEY = 'nat_' + 'b'.repeat(40);

const handlers = new Map();
const embeddingInits = [];
let credentials;

before(() => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-key-embeddings-'));
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
  const fakeNative = new Proxy({ getHardwareId: () => 'natively-key-embeddings-test-hwid' }, {
    get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : function nativeStub() {}),
  });
  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
    return origLoad.call(this, request, ...rest);
  };
  // Nothing here may reach the real API: the key check and Pro activation both fetch.
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }), text: async () => '' });

  const mod = require(COMPILED);
  const ragManager = {
    initializeEmbeddings: (config) => { embeddingInits.push(config); return Promise.resolve(); },
    retryPendingEmbeddings: async () => {},
  };
  const appState = {
    processingHelper: { getLLMHelper: () => ({ setModel: noop, setNativelyKey: noop }) },
    sendModelChanged: noop,
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => null,
    getRAGManager: () => ragManager,
    scheduleModeReferenceIndexRetry: noop,
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }

  credentials = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js'))
    .CredentialsManager.getInstance();
  credentials.setNativelyApiKey(OLD_KEY);
});

describe('set-natively-api-key re-points the embedder at the new key', () => {
  test('the embedding pipeline is re-initialised with the key just saved', async () => {
    assert.ok(handlers.has('set-natively-api-key'), 'set-natively-api-key must be registered');
    embeddingInits.length = 0;
    await handlers.get('set-natively-api-key')({}, NEW_KEY);
    assert.ok(embeddingInits.length >= 1, 'saving a Natively key must re-initialise embeddings; it did not');
    const last = embeddingInits[embeddingInits.length - 1];
    assert.equal(
      last.nativelyApiKey,
      credentials.getNativelyApiKey(),
      'the embedder must receive the key that is stored now, not the one it was built with',
    );
    assert.notEqual(last.nativelyApiKey, OLD_KEY, 'the cancelled key must not be what the embedder keeps');
  });
});
