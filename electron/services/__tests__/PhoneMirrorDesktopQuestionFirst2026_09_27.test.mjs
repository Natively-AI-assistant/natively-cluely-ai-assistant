// electron/services/__tests__/PhoneMirrorDesktopQuestionFirst2026_09_27.test.mjs
//
// "It should sync both ways: if the user sends a question from the desktop app,
// the question should also appear in the web app, not when the answer is
// generated." The desktop's default chat path (Context V3) published the
// question AND the answer to the phone together, after the whole answer was
// written; the phone saw nothing until then, and no answer streamed.
//
// Now the question goes out as soon as the desktop has it, marked as awaiting
// an answer (the phone shows Thinking under it, as the overlay does), the
// answer streams to the phone under the same id, and the stream is always
// closed (done, or an error that keeps what was written).
//
//   1. EXECUTED against the real service over a real socket: the awaiting
//      flag, its replay to a phone that connects mid-wait, one publish per id,
//      and an empty done that still ends the wait.
//   2. SOURCE ORDER in ipcHandlers' V3 branch (building the V3 answer needs the
//      whole retrieval/LLM stack, which this file cannot stand up): the
//      question is published before the prompt is built, each token is
//      mirrored, and the end-of-answer publish of question+answer is gone.
//
// Platform-agnostic (loopback ws + source reads); same on macOS and Windows.

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
const serviceBundle = process.env.PHONE_MIRROR_SERVICE_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_SERVICE_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-desk-q-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class {
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
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
});

after(async () => {
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.history = [];
  svc.livePartial = null;
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  token = info.token;
  assert.ok(port < 4123 || port >= 4135);
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await settle(30);
  return { ws, frames, of: (t) => frames.filter((f) => f.type === t) };
}

describe('the question reaches the phone first', () => {
  test('a desktop question goes out at once, marked as awaiting its answer', async () => {
    const phone = await connectPhone();
    svc.publishUserMessage('41', 'How do we roll this out?', { awaitingAnswer: true });
    await settle(30);
    const [q] = phone.of('user');
    assert.equal(q.id, 'u:41');
    assert.equal(q.content, 'How do we roll this out?');
    assert.equal(q.awaiting, true);
    phone.ws.close();
  });

  test('a phone that connects while it waits sees it waiting; not once the answer streams', async () => {
    svc.publishUserMessage('42', 'Waiting one', { awaitingAnswer: true });
    const early = await connectPhone();
    assert.equal(early.of('history')[0].messages.find((m) => m.id === 'u:42').awaiting, true);
    early.ws.close();
    svc.publishToken('42', 'First words ');
    const later = await connectPhone();
    assert.equal(later.of('history')[0].messages.find((m) => m.id === 'u:42').awaiting, undefined);
    assert.equal(later.of('token')[0].token, 'First words ');
    later.ws.close();
  });

  test('published once per id (a fallback path publishes the same question again)', async () => {
    const phone = await connectPhone();
    svc.publishUserMessage('43', 'Once', { awaitingAnswer: true });
    svc.publishUserMessage('43', 'Once', { awaitingAnswer: true });
    await settle(30);
    assert.equal(phone.of('user').length, 1);
    assert.equal(svc.history.filter((m) => m.id === 'u:43').length, 1);
    phone.ws.close();
  });

  test('an answer with nothing to show still ends the wait', async () => {
    svc.publishUserMessage('44', 'Nothing comes', { awaitingAnswer: true });
    const phone = await connectPhone();
    svc.publishDone('44', '');
    await settle(30);
    assert.deepEqual(phone.of('done').map((d) => [d.streamId, d.content]), [['44', '']]);
    assert.ok(!svc.history.some((m) => m.id === 'a:44'), 'nothing recorded');
    const again = await connectPhone();
    assert.equal(again.of('history')[0].messages.find((m) => m.id === 'u:44').awaiting, undefined);
    again.ws.close();
    phone.ws.close();
  });
});

describe('the desktop chat path publishes in that order', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const start = ipc.indexOf('if (!callerOwnsPrompt && isContextIntelligenceV3Enabled()) {');
  const v3 = ipc.slice(start, ipc.indexOf('} catch (v3Err: any) {', start));

  test('the V3 branch publishes the question, awaiting, before it builds the prompt', () => {
    assert.ok(start > 0);
    const publish = v3.indexOf("publishUserMessage(String(myStreamId), String(message || ''), { awaitingAnswer: true })");
    assert.ok(publish > 0, 'published with awaitingAnswer');
    assert.ok(publish < v3.indexOf('await buildV3Prompt('), 'before any answer work');
  });

  test('each token is mirrored as it is written, and the stream is closed either way', () => {
    const loop = v3.slice(v3.indexOf('for await (const tok of v3Stream.stream)'), v3.indexOf("event.sender.send('gemini-stream-done'"));
    assert.match(loop, /publishToken\(String\(myStreamId\), tok\)/);
    assert.match(loop, /superseded_by_newer_stream[\s\S]*publishError\(String\(myStreamId\)/, 'a superseded answer is closed on the phone too');
    const end = v3.slice(v3.indexOf("event.sender.send('gemini-stream-done'"));
    assert.match(end, /if \(v3Truncated\) PhoneMirrorService\.getInstance\(\)\.publishError[\s\S]*else PhoneMirrorService\.getInstance\(\)\.publishDone\(String\(myStreamId\), finalText\)/);
  });

  test('the old end-of-answer publish (question + whole answer together) is gone', () => {
    assert.doesNotMatch(v3, /publishAssistantMessage\(String\(myStreamId\), finalText, 'Chat'\)/);
    assert.equal((v3.match(/publishUserMessage\(/g) || []).length, 1);
  });
});
