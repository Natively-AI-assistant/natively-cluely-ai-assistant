// A phone-mirror answer that finishes after the session was reset must not be
// saved into the new session.
//
// Desktop chat streams live in _chatStreamsBySender, and the overlay's
// session-reset handler calls cancelChatStream(), so a meeting stopped
// mid-answer drops the late desktop answer. The phone path has no registry: it
// awaited the provider stream and then called addAssistantMessage/logUsage on
// whatever session existed by then — the NEXT one, after
// MeetingPersistence.stopMeeting() had reset it. The fix reads
// IntelligenceManager.getSessionEpoch() before the stream and skips the save if
// it moved. The phone still receives the full answer.
//
// This EXECUTES the real phone command listener out of the compiled bundle.
// The listener is a closure inside initializeIpcHandlers(), registered on the
// bundle's own PhoneMirrorService instance, so it is captured as it is added
// to that instance's listener Set.
//
// Requires: npm run build:electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');

const noop = () => {};
const sends = [];
const win = { isDestroyed: () => false, webContents: { send: (channel, ...args) => sends.push([channel, ...args]) } };
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-chat-session-reset-'));
const fakeElectron = {
  app: {
    getPath: () => userData, getAppPath: () => ROOT, isPackaged: false,
    getVersion: () => '0.0.0-test', getName: () => 'natively',
    on: noop, once: noop, off: noop, removeAllListeners: noop,
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [win], getFocusedWindow: () => win }),
  ipcMain: {
    handle: noop, handleOnce: noop, on: noop, once: noop, off: noop,
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
const fakeNative = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : function nativeStub() {}) });
const origLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'electron') return fakeElectron;
  if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
  return origLoad.call(this, request, ...rest);
};
// Nothing here may reach a real endpoint.
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });

// Unknown members resolve to a no-op function, so the handler's incidental
// calls succeed without this file listing every one of them.
const stub = (target) => new Proxy(target, {
  get: (t, key) => (key in t ? t[key] : key === 'then' ? undefined : () => undefined),
});

let sessionEpoch = 0;
let releaseStream = () => {};
const writes = [];
const intelligenceManager = stub({
  getSessionEpoch: () => sessionEpoch,
  getFormattedContext: () => '',
  addTranscript: (segment) => writes.push(['addTranscript', segment?.text]),
  addAssistantMessage: (text, _decision, surface) => writes.push(['addAssistantMessage', text, surface]),
  logUsage: (_type, question, answer) => writes.push(['logUsage', question, answer]),
});
const llmHelper = stub({
  // Held open until the test decides whether the session is reset first.
  streamChat: async function* () {
    await new Promise((resolve) => { releaseStream = resolve; });
    yield 'The pricing decision ';
    yield 'from meeting A.';
  },
  isUsingOllama: () => false,
  isUsingCodexCli: () => false,
  performanceIdentity: undefined, // opts the turn out of the performance profile
});
const appState = stub({
  getIntelligenceManager: () => intelligenceManager,
  processingHelper: { getLLMHelper: () => llmHelper },
  getMainWindow: () => win,
});

const captured = [];
const origAdd = Set.prototype.add;
Set.prototype.add = function capture(value) {
  if (typeof value === 'function' && /cmd\.type === ["']chat["']/.test(Function.prototype.toString.call(value))) {
    captured.push(value);
  }
  return origAdd.call(this, value);
};
try {
  const mod = require(COMPILED);
  // initializeIpcHandlers registers the phone listener long before the
  // app-lifecycle wiring at its end, which these stubs cannot satisfy.
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }
} finally {
  Set.prototype.add = origAdd;
}

async function askFromPhone({ resetMidStream }) {
  writes.length = 0;
  sends.length = 0;
  assert.equal(captured.length, 1, 'could not capture the phone command listener from the compiled bundle');
  const run = captured[0]({ type: 'chat', message: 'what did we decide on pricing?' });
  await new Promise((r) => setImmediate(r)); // the handler is now awaiting the stream
  if (resetMidStream) sessionEpoch++; // MeetingPersistence.stopMeeting() -> session.reset()
  releaseStream();
  await run;
}

const saved = () => writes.filter(([fn]) => fn === 'addAssistantMessage' || fn === 'logUsage');
const deliveredText = () => sends.filter(([ch]) => ch === 'gemini-stream-token').map(([, tok]) => tok).join('');

describe('phone-mirror chat vs session reset', () => {
  test('control: with no reset, the answer is delivered and saved', async () => {
    await askFromPhone({ resetMidStream: false });
    assert.equal(deliveredText(), 'The pricing decision from meeting A.');
    assert.deepEqual(saved(), [
      ['addAssistantMessage', 'The pricing decision from meeting A.', 'phone_mirror'],
      ['logUsage', 'what did we decide on pricing?', 'The pricing decision from meeting A.'],
    ]);
  });

  test('a reset during the stream: the answer is still delivered, but not saved into the new session', async () => {
    await askFromPhone({ resetMidStream: true });
    assert.equal(deliveredText(), 'The pricing decision from meeting A.', 'the phone user must still get the answer');
    assert.ok(sends.some(([ch]) => ch === 'gemini-stream-done'), 'the stream must still complete');
    assert.deepEqual(saved(), [], 'the ended session\'s answer was saved into the new session');
  });
});
