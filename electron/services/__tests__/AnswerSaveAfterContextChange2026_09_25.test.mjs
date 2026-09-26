// An answer that finishes after the session was reset (meeting stop), or after
// a mode switch cleared its context, is still shown — but it must not be saved
// into the context that replaced the one it was asked in.
//
// Both chat surfaces await the provider and then save the answer:
//   - Phone-mirror chat has no stream registry, so neither the overlay's
//     cancelChatStream() on session-reset nor modes:set-active's abort reaches
//     it. Live on main: a phone answer asked before a mode switch was saved into
//     the cleared context and fed back into the next question's prompt.
//   - Desktop chat from the LAUNCHER (GlobalChat / MeetingChat fallback) is not
//     cancelled at meeting stop — only the overlay cancels its own stream. Live
//     on main: the launcher answer was saved into the session that replaced the
//     stopped meeting.
// Each now reads IntelligenceManager.getContextEpoch() when the question
// arrives (SessionTracker.reset() and clearSessionContext() both advance it)
// and skips the save if it moved.
//
// This EXECUTES the real handlers out of the compiled bundle: the phone command
// listener (a closure inside initializeIpcHandlers(), captured as it is added to
// the bundle's own PhoneMirrorService listener Set) and the registered
// gemini-chat-stream handler, on both its V3 and legacy paths.
//
// Requires: npm run build:electron.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');
const V3_ENV = 'NATIVELY_CONTEXT_INTELLIGENCE_V3';

const noop = () => {};
const handlers = new Map();
const windowSends = [];
const win = { isDestroyed: () => false, webContents: { send: (channel, ...args) => windowSends.push([channel, ...args]) } };
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-save-context-change-'));
const fakeElectron = {
  app: {
    getPath: () => userData, getAppPath: () => ROOT, isPackaged: false,
    getVersion: () => '0.0.0-test', getName: () => 'natively',
    on: noop, once: noop, off: noop, removeAllListeners: noop,
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [win], getFocusedWindow: () => win }),
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
const fakeNative = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : function nativeStub() {}) });
const origLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'electron') return fakeElectron;
  if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
  return origLoad.call(this, request, ...rest);
};
// Nothing here may reach a real endpoint.
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });

// Unknown members resolve to a no-op function, so the handlers' incidental
// calls succeed without this file listing every one of them.
const stub = (target) => new Proxy(target, {
  get: (t, key) => (key in t ? t[key] : key === 'then' ? undefined : () => undefined),
});

let contextEpoch = 0;
let releaseStream = null;
const writes = [];
// Held open until the test decides whether the context changes first.
async function* heldAnswer(text) {
  await new Promise((resolve) => { releaseStream = resolve; });
  const half = Math.floor(text.length / 2);
  yield text.slice(0, half);
  yield text.slice(half);
}
let answerText = '';
const intelligenceManager = stub({
  getContextEpoch: () => contextEpoch,
  getFormattedContext: () => '',
  getLastAssistantMessage: () => null,
  addTranscript: (segment) => writes.push(['addTranscript', segment?.text]),
  addAssistantMessage: (text, _decision, surface) => writes.push(['addAssistantMessage', text, surface]),
  logUsage: (_type, question, answer) => writes.push(['logUsage', question, answer]),
});
const llmHelper = stub({
  streamChat: () => heldAnswer(answerText),
  streamChatWithOutcome: () => ({ stream: heldAnswer(answerText), outcome: { truncated: false } }),
  isUsingOllama: () => false,
  isUsingCodexCli: () => false,
  getCodexSelectionAuthError: () => null,
  performanceIdentity: undefined, // opts the turn out of the performance profile
});
const appState = stub({
  getIntelligenceManager: () => intelligenceManager,
  processingHelper: { getLLMHelper: () => llmHelper },
  getMainWindow: () => win,
});

const phoneListeners = [];
const origAdd = Set.prototype.add;
Set.prototype.add = function capture(value) {
  if (typeof value === 'function' && /cmd\.type === ["']chat["']/.test(Function.prototype.toString.call(value))) {
    phoneListeners.push(value);
  }
  return origAdd.call(this, value);
};
try {
  const mod = require(COMPILED);
  // initializeIpcHandlers registers both handlers long before the app-lifecycle
  // wiring at its end, which these stubs cannot satisfy.
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }
} finally {
  Set.prototype.add = origAdd;
}

const savedAnswer = () => writes.filter(([fn]) => fn === 'addAssistantMessage' || fn === 'logUsage');

async function waitForHeldStream() {
  for (let i = 0; i < 250 && !releaseStream; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(releaseStream, 'the handler never reached the provider stream');
}

// SessionTracker.reset() (meeting stop) or clearSessionContext() (mode switch).
async function finishAnswer({ contextChangedMidStream }) {
  await waitForHeldStream();
  if (contextChangedMidStream) contextEpoch++;
  const release = releaseStream;
  releaseStream = null;
  release();
}

afterEach(() => {
  writes.length = 0;
  windowSends.length = 0;
  delete process.env[V3_ENV];
});

describe('phone-mirror chat vs a context change mid-answer', () => {
  async function askFromPhone(opts) {
    answerText = 'The pricing decision from meeting A.';
    assert.equal(phoneListeners.length, 1, 'could not capture the phone command listener from the compiled bundle');
    const run = phoneListeners[0]({ type: 'chat', message: 'what did we decide on pricing?' });
    await finishAnswer(opts);
    await run;
    return windowSends.filter(([ch]) => ch === 'gemini-stream-token').map(([, tok]) => tok).join('');
  }

  test('control: with no change, the answer is delivered and saved', async () => {
    const shown = await askFromPhone({ contextChangedMidStream: false });
    assert.equal(shown, 'The pricing decision from meeting A.');
    assert.deepEqual(savedAnswer(), [
      ['addAssistantMessage', 'The pricing decision from meeting A.', 'phone_mirror'],
      ['logUsage', 'what did we decide on pricing?', 'The pricing decision from meeting A.'],
    ]);
  });

  test('a reset or mode switch during the stream: still delivered, not saved', async () => {
    const shown = await askFromPhone({ contextChangedMidStream: true });
    assert.equal(shown, 'The pricing decision from meeting A.', 'the phone user must still get the answer');
    assert.ok(windowSends.some(([ch]) => ch === 'gemini-stream-done'), 'the stream must still complete');
    assert.deepEqual(savedAnswer(), [], 'the answer was saved into the context that replaced the one it was asked in');
  });
});

describe('desktop chat (launcher) vs a context change mid-answer', () => {
  const QUESTION = 'What is the Q3 plan?';
  const ANSWER = 'Launcher answer about the Q3 plan.';

  async function askFromLauncher({ v3, ...opts }) {
    answerText = ANSWER;
    process.env[V3_ENV] = v3 ? '1' : '0';
    const handler = handlers.get('gemini-chat-stream');
    assert.equal(typeof handler, 'function', 'gemini-chat-stream was not registered');
    const sent = [];
    const event = {
      sender: {
        id: 42, send: (...args) => sent.push(args), isDestroyed: () => false,
        once: noop, on: noop, getURL: () => 'http://127.0.0.1/?window=launcher',
      },
    };
    const run = handler(event, QUESTION, undefined, undefined, { skipSystemPrompt: false });
    await finishAnswer(opts);
    await run;
    return {
      shown: sent.filter(([ch]) => ch === 'gemini-stream-token').map(([, tok]) => tok).join(''),
      done: sent.some(([ch]) => ch === 'gemini-stream-done'),
    };
  }

  for (const v3 of [true, false]) {
    const pathName = v3 ? 'V3' : 'legacy';

    test(`${pathName} control: with no change, the answer is shown and saved`, async () => {
      const { shown, done } = await askFromLauncher({ v3, contextChangedMidStream: false });
      assert.equal(shown, ANSWER);
      assert.equal(done, true);
      assert.deepEqual(savedAnswer(), [
        ['addAssistantMessage', ANSWER, 'manual_chat'],
        ['logUsage', QUESTION, ANSWER],
      ]);
    });

    test(`${pathName}: a meeting stop or mode switch during the answer — still shown, not saved`, async () => {
      const { shown, done } = await askFromLauncher({ v3, contextChangedMidStream: true });
      assert.equal(shown, ANSWER, 'the launcher user must still get the answer');
      assert.equal(done, true, 'the stream must still complete, or the launcher bubble stays "streaming"');
      assert.deepEqual(savedAnswer(), [], 'the answer was saved into the context that replaced the one it was asked in');
    });
  }
});
