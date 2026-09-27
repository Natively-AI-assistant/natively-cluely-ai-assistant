// electron/services/__tests__/PhoneMirrorPhoneActions2026_09_27.test.mjs
//
// "I can't call Recap from the webpage." The phone's Recap button sent the
// action `dynamicAction4`, and PhoneMirrorService only accepted action names
// matching /^[a-zA-Z:_-]+$/ — no digits — so the command was dropped without a
// word. The button now sends `recap` and the pattern allows digits.
//
// A second drift of the same kind: the phone waits for each action's answer
// under the label the desktop publishes it with, and Follow Up publishes
// "Follow-Up Questions", not "Follow Up", so its placeholder never resolved.
//
//   1. EXECUTED: every action the page can send (plus the desktop's own
//      dynamicAction4) goes through a real phone socket to the real service
//      and must reach onPhoneCommand.
//   2. CONTRACT: for each action the page waits on, follow it to the IPC
//      handler the overlay calls and assert the page expects the label that
//      handler publishes to the phone.
//
// Ports: same 4123-4134 guard as PhoneMirrorTranscript2026_09_26.test.mjs.
// Platform-agnostic (loopback ws + source reads); same on macOS and Windows.

import { test, describe, before, after } from 'node:test';
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
const clientBundle = process.env.PHONE_MIRROR_CLIENT_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_CLIENT_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/phoneMirrorClient.js');

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const { PHONE_MIRROR_HTML: html } = require(clientBundle);
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const pageActions = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-actions-'));
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
  const mod = await import(pathToFileURL(serviceBundle).href);
  svc = mod.PhoneMirrorService.getInstance();
});

after(async () => {
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('phone actions reach the desktop', () => {
  test('the page has action buttons, Recap among them', () => {
    assert.ok(pageActions.length >= 6, `found ${pageActions.length}`);
    assert.ok(pageActions.includes('recap'), 'Recap sends the recap action');
  });

  test('every action the page sends (and dynamicAction4) reaches onPhoneCommand', async () => {
    const info = await svc.start({ exposeOnLan: false, persist: false });
    assert.ok(info.port < 4123 || info.port >= 4135);
    const received = [];
    const off = svc.onPhoneCommand((cmd) => { if (cmd.type === 'action') received.push(cmd.action); });
    const ws = new WS(`ws://127.0.0.1:${info.port}/ws?t=${encodeURIComponent(info.token)}`);
    ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const sent = [...pageActions, 'dynamicAction4'];
    for (const action of sent) ws.send(JSON.stringify({ type: 'action', action }));
    await new Promise((r) => setTimeout(r, 150));
    ws.close();
    off?.();
    assert.deepEqual(received, sent);
  });

  test('malformed action names are still refused', async () => {
    const info = await svc.start({ exposeOnLan: false, persist: false });
    const received = [];
    const off = svc.onPhoneCommand((cmd) => { if (cmd.type === 'action') received.push(cmd.action); });
    const ws = new WS(`ws://127.0.0.1:${info.port}/ws?t=${encodeURIComponent(info.token)}`);
    ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    for (const action of ['recap; rm -rf', 'a'.repeat(65), '', 'recap\n', '../x']) {
      ws.send(JSON.stringify({ type: 'action', action }));
    }
    await new Promise((r) => setTimeout(r, 150));
    ws.close();
    off?.();
    assert.deepEqual(received, []);
  });
});

describe('the phone waits for the label the desktop actually publishes', () => {
  // action → overlay handler → preload method → IPC channel. Each hop is
  // checked against the source below, so a rename anywhere breaks this test.
  const CHAIN = {
    whatToAnswer: { handler: 'handleWhatToSay', method: 'generateWhatToSay', channel: 'generate-what-to-say' },
    followUp: { handler: 'handleFollowUpQuestions', method: 'generateFollowUpQuestions', channel: 'generate-follow-up-questions' },
    clarify: { handler: 'handleClarify', method: 'generateClarify', channel: 'generate-clarify' },
    codeHint: { handler: 'handleCodeHint', method: 'generateCodeHint', channel: 'generate-code-hint' },
    brainstorm: { handler: 'handleBrainstorm', method: 'generateBrainstorm', channel: 'generate-brainstorm' },
    recap: { handler: 'handleRecap', method: 'generateRecap', channel: 'generate-recap' },
  };
  const overlay = read('src/components/NativelyInterface.tsx');
  const preload = read('electron/preload.ts');
  const ipc = read('electron/ipcHandlers.ts');

  function pageExpects(action) {
    const m = script.match(new RegExp(`${action}: \\{ label: '[^']*', expect: \\[([^\\]]*)\\] \\}`));
    assert.ok(m, `page waits on ${action}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  function publishedLabel(channel) {
    const reg = new RegExp(`safeHandle\\(\\s*'${channel}'`).exec(ipc);
    assert.ok(reg, `ipcHandlers registers ${channel}`);
    const start = reg.index;
    const next = ipc.indexOf('safeHandle(', start + 10);
    const block = ipc.slice(start, next < 0 ? undefined : next);
    const m = block.match(/publishAssistantMessage\(\s*[^,]+,\s*[^,]+,\s*'([^']+)'/);
    assert.ok(m, `${channel} publishes to the phone`);
    return m[1];
  }

  for (const [action, hop] of Object.entries(CHAIN)) {
    test(`${action}: page expects "${hop.channel}"'s label`, () => {
      assert.ok(pageActions.includes(action), `page sends ${action}`);
      assert.match(overlay, new RegExp(`action === '${action}'\\)\\s*handlers\\.${hop.handler}\\(`), `overlay maps ${action} → ${hop.handler}`);
      // The handler's body: from its definition to the next handler's.
      const start = overlay.indexOf(`const ${hop.handler} = `);
      assert.ok(start >= 0, `overlay defines ${hop.handler}`);
      const end = overlay.indexOf('\n  const handle', start + 10);
      const body = overlay.slice(start, end < 0 ? undefined : end);
      assert.ok(body.includes(`electronAPI.${hop.method}(`), `${hop.handler} calls ${hop.method}`);
      assert.match(preload, new RegExp(`${hop.method}:[\\s\\S]{0,200}?invoke\\('${hop.channel}'`), `${hop.method} invokes ${hop.channel}`);
      assert.ok(pageExpects(action).includes(publishedLabel(hop.channel)), `expects ${JSON.stringify(pageExpects(action))}, desktop publishes "${publishedLabel(hop.channel)}"`);
    });
  }
});
