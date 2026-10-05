// electron/services/__tests__/GistNotPersisted2026_09_30.test.mjs
//
// EXECUTED against the built modules: an answer ending in a [[GIST]] line is
//   - stored in SessionTracker history / transcript / usage log WITHOUT it
//     (one chokepoint for every addAssistantMessage / logUsage / pushUsage
//     caller, so the meeting DB never receives it either);
//   - sent to the phone with `content` = the answer text and the gist carried
//     separately in `gist` (with or without the desktop renderer), so the chip
//     still renders and "Copy conversation" copies plain text.
//
// Loopback ws + in-memory state; identical on macOS and Windows.

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
const distPath = (rel) => pathToFileURL(path.resolve(repoRoot, 'dist-electron/electron', rel)).href;

const RAW = 'I shard by tenant first, then add read replicas for the hot tables.\n[[GIST]] Shard by tenant, then replicate';
const BODY = 'I shard by tenant first, then add read replicas for the hot tables.';
const GIST = 'Shard by tenant, then replicate';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-gist-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {}, isPackaged: false },
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
let SessionTracker;
let svc;
let port = 0;
let token = '';

before(async () => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ SessionTracker } = await import(distPath('SessionTracker.js')));
  svc = (await import(distPath('services/PhoneMirrorService.js'))).PhoneMirrorService.getInstance();
});

after(async () => {
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('SessionTracker stores the answer text, not the gist line', () => {
  test('history, last-answer and transcript', () => {
    const st = new SessionTracker();
    assert.equal(st.addAssistantMessage(RAW, undefined, 'manual_chat'), true);
    assert.equal(st.getLastAssistantMessage(), BODY);
    assert.equal(st.getLastAssistantMessage('manual_chat'), BODY);
    const last = st.getFullTranscript().at(-1);
    assert.equal(last.speaker, 'assistant');
    assert.equal(last.text, BODY);
  });
  test('usage log via logUsage and pushUsage (the meeting DB source)', () => {
    const st = new SessionTracker();
    st.logUsage('chat', 'How would you scale it?', RAW);
    st.pushUsage({ type: 'assist', timestamp: Date.now(), question: 'q', answer: RAW });
    const usage = st.getFullUsage();
    assert.deepEqual(usage.map((u) => u.answer), [BODY, BODY]);
    assert.equal(st.getRecentManualTurn().answer, BODY);
  });
  test('an answer without a gist is stored exactly as before', () => {
    const st = new SessionTracker();
    st.addAssistantMessage('A plain answer with no gist line at all.', undefined, 'manual_chat');
    assert.equal(st.getLastAssistantMessage(), 'A plain answer with no gist line at all.');
  });
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

describe('phone mirror: content without the gist, gist on its own', () => {
  beforeEach(async () => {
    if (svc.isRunning()) await svc.stop({ persist: false });
    svc.history = [];
    svc.livePartial = null;
    svc.setAnswerRenderer(null);
    const info = await svc.start({ exposeOnLan: false, persist: false });
    port = info.port;
    token = info.token;
  });

  test('done (no desktop renderer): content is the body, gist rides alongside', async () => {
    const phone = await connectPhone();
    svc.publishToken('g1', RAW);
    svc.publishDone('g1', RAW);
    await settle(30);
    const [done] = phone.of('done');
    assert.equal(done.content, BODY);
    assert.equal(done.gist, GIST);
    const stored = svc.history.find((m) => m.id === 'a:g1');
    assert.equal(stored.content, BODY);
    assert.equal(stored.gist, GIST);
    phone.ws.close();
  });

  test('done (desktop renderer): renderer sees the RAW answer, content is still the body', async () => {
    const seen = [];
    svc.setAnswerRenderer((md) => { seen.push(md); return { html: '<p>x</p>', gist: md.includes('[[GIST]]') ? GIST : null }; });
    const phone = await connectPhone();
    svc.publishDone('g2', RAW);
    await settle(30);
    const [done] = phone.of('done');
    assert.equal(seen.at(-1), RAW);
    assert.equal(done.content, BODY);
    assert.equal(done.gist, GIST);
    assert.equal(done.html, '<p>x</p>');
    phone.ws.close();
  });

  test('assistant messages (hotkey answers) and the history replay follow the same rule', async () => {
    svc.publishAssistantMessage('g3', RAW, 'What to Answer');
    const phone = await connectPhone();
    const replay = phone.of('history')[0].messages.find((m) => m.id === 'a:g3');
    assert.equal(replay.content, BODY);
    assert.equal(replay.gist, GIST);
    phone.ws.close();
  });

  test('no gist: payload unchanged, no gist field', async () => {
    const phone = await connectPhone();
    svc.publishDone('g4', 'Plain answer.');
    await settle(30);
    const [done] = phone.of('done');
    assert.equal(done.content, 'Plain answer.');
    assert.equal('gist' in done, false);
    phone.ws.close();
  });
});
