// electron/services/__tests__/PhoneMirrorAnswerRendering2026_09_27.test.mjs
//
// Two Phone Mirror fixes, pinned against the REAL service over a real socket:
//
// 1. Answers reach the phone rendered (html + gist) by the answer renderer
//    main.ts registers: labelled answers, final phone-chat answers, history,
//    and throttled frames while a phone question streams. Without a renderer,
//    or when it throws, answers still go out and the page renders them.
// 2. "If I stop a session and start a new one, the web page continues the same
//    session while the app is in a new one." A meeting START now clears the
//    service's chat history (a phone that connects gets a clean session) and
//    the page is told to start over (meeting.reset). Since 2026-09-27 a
//    meeting END does too: the phone shows the meeting is over on a clean
//    canvas (Evin: "check the summary on the desktop, open a new canvas").
//
// Same electron stub and 4123-4134 port guard as the other PhoneMirror tests.
// Platform-agnostic (loopback ws); same on macOS and Windows.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const WS = require('ws').WebSocket;
const http = require('node:http');

const dist = (f) => path.resolve(repoRoot, 'dist-electron/electron/services', f);
const serviceBundle = process.env.PHONE_MIRROR_SERVICE_BUNDLE ? path.resolve(process.env.PHONE_MIRROR_SERVICE_BUNDLE) : dist('PhoneMirrorService.js');
const markdownBundle = process.env.PHONE_MIRROR_MARKDOWN_BUNDLE ? path.resolve(process.env.PHONE_MIRROR_MARKDOWN_BUNDLE) : dist('phoneMirrorMarkdown.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-render-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class {
    static getFocusedWindow() {
      return null;
    }
    static getAllWindows() {
      return [];
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
const originalListen = http.Server.prototype.listen;
let svc;
let renderPhoneAnswer;
let port = 0;
let token = '';

before(async () => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  http.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' && args[0] >= 4123 && args[0] < 4135) {
      process.nextTick(() => this.emit('error', Object.assign(new Error('taken (test)'), { code: 'EADDRINUSE' })));
      return this;
    }
    return originalListen.apply(this, args);
  };
  svc = (await import(pathToFileURL(serviceBundle).href)).PhoneMirrorService.getInstance();
  ({ renderPhoneAnswer } = require(markdownBundle));
});

after(async () => {
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const ANSWER = 'Use a **stack**: $O(n)$.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[[GIST]] One pass with a stack';

beforeEach(async () => {
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.setAnswerRenderer(renderPhoneAnswer);
  svc.history = [];
  svc.publishMeetingState(false);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  token = info.token;
  assert.ok(port < 4123 || port >= 4135);
});

async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await settle(30);
  return { ws, frames, of: (t) => frames.filter((f) => f.type === t) };
}

describe('answers reach the phone rendered', () => {
  test('a labelled answer carries html and its gist', async () => {
    const phone = await connectPhone();
    svc.publishAssistantMessage('1', ANSWER, 'Code Hint');
    await settle(40);
    const [a] = phone.of('assistant');
    assert.equal(a.content, ANSWER, 'raw markdown still sent (copy, fallback)');
    assert.equal(a.gist, 'One pass with a stack');
    assert.match(a.html, /<strong>stack<\/strong>/);
    assert.match(a.html, /<table>/);
    assert.match(a.html, /<math/);
    assert.doesNotMatch(a.html, /\[\[GIST\]\]/);
    phone.ws.close();
  });

  test('history replays the rendered answers', async () => {
    svc.publishAssistantMessage('2', ANSWER, 'Recap');
    const phone = await connectPhone();
    const [h] = phone.of('history');
    const m = h.messages.find((x) => x.id === 'a:2');
    assert.ok(m?.html?.includes('<table>'), 'history item has html');
    assert.equal(m.gist, 'One pass with a stack');
    phone.ws.close();
  });

  test('a streaming phone answer: throttled render frames, then a rendered done', async () => {
    const phone = await connectPhone();
    const words = ANSWER.split(/(?<= )/);
    for (const w of words) { svc.publishToken('s1', w); await settle(8); }
    await settle(200);
    const frames = phone.of('render');
    assert.ok(frames.length >= 1, 'render frames sent');
    assert.ok(frames.length < words.length, `throttled (${frames.length} frames for ${words.length} tokens)`);
    for (const f of frames) assert.doesNotMatch(f.html, /\[\[/, 'a gist marker never shows mid-stream');
    svc.publishDone('s1', ANSWER);
    await settle(40);
    const [done] = phone.of('done');
    assert.equal(done.gist, 'One pass with a stack');
    assert.match(done.html, /<table>/);
    const before = phone.of('render').length;
    await settle(200);
    assert.equal(phone.of('render').length, before, 'no stray frame after done');
    phone.ws.close();
  });

  test('a phone joining mid-stream gets the text so far and its rendering', async () => {
    svc.publishToken('s2', 'Partial **answer** ');
    const phone = await connectPhone();
    const [tok] = phone.of('token');
    const [ren] = phone.of('render');
    assert.equal(tok.token, 'Partial **answer** ');
    assert.equal(ren.streamId, 's2');
    assert.match(ren.html, /<strong>answer<\/strong>/);
    phone.ws.close();
  });

  test('no renderer: answers still go out, unrendered, for the page to render', async () => {
    svc.setAnswerRenderer(null);
    const phone = await connectPhone();
    svc.publishAssistantMessage('3', ANSWER, 'Clarify');
    svc.publishToken('s3', 'x ');
    await settle(200);
    const [a] = phone.of('assistant');
    assert.equal(a.content, ANSWER);
    assert.equal(a.html, undefined);
    assert.equal(phone.of('render').length, 0);
    phone.ws.close();
  });

  test('a renderer that throws never blocks the answer', async () => {
    svc.setAnswerRenderer(() => { throw new Error('boom'); });
    const phone = await connectPhone();
    svc.publishAssistantMessage('4', ANSWER, 'Clarify');
    await settle(40);
    const [a] = phone.of('assistant');
    assert.equal(a.content, ANSWER);
    assert.equal(a.html, undefined);
    phone.ws.close();
  });
});

describe('a new meeting is a new session on the phone', () => {
  test('meeting end and start both clear the chat history and tell the page to start over', async () => {
    svc.publishMeetingState(true);
    svc.publishAssistantMessage('old', 'Answer from the FIRST meeting', 'Recap');
    const phone = await connectPhone();
    svc.publishMeetingState(false);               // stop: the meeting is over, a clean canvas
    await settle(30);
    const afterStop = await connectPhone();
    assert.deepEqual(afterStop.of('history')[0].messages, [], 'stopping clears it (the summary is on the desktop)');
    assert.equal(afterStop.of('transcript-history')[0].meetingEnded, true);
    afterStop.ws.close();

    svc.publishMeetingState(true);                // new session
    await settle(30);
    assert.deepEqual(phone.of('meeting').map((m) => [m.active, m.reset]), [[false, true], [true, true]]);
    const fresh = await connectPhone();
    assert.deepEqual(fresh.of('history')[0].messages, [], 'the old session is gone');
    assert.deepEqual(fresh.of('transcript-history')[0].segments, []);
    fresh.ws.close();
    phone.ws.close();
  });

  test('an answer still streaming at the switch stays in the old session', async () => {
    svc.publishMeetingState(true);
    svc.publishToken('old-stream', 'half an answer ');
    svc.publishMeetingState(false);
    svc.publishMeetingState(true);
    const phone = await connectPhone();
    assert.equal(phone.of('token').length, 0, 'not replayed on connect');
    assert.equal(phone.of('render').length, 0);
    // Its late tokens and completion are neither sent nor kept...
    svc.publishToken('old-stream', 'late ');
    svc.publishDone('old-stream', 'half an answer late');
    await settle(200);
    assert.equal(phone.of('token').length + phone.of('done').length + phone.of('render').length, 0);
    const later = await connectPhone();
    assert.deepEqual(later.of('history')[0].messages, [], 'not recorded into the new session');
    // ...while a new answer in the new session flows normally.
    svc.publishToken('new-stream', 'fresh ');
    svc.publishDone('new-stream', 'fresh answer');
    await settle(60);
    assert.equal(later.of('done').length, 1);
    later.ws.close();
    phone.ws.close();
  });
});
