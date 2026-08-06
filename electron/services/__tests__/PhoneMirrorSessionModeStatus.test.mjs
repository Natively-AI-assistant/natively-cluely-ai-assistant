/**
 * Ticket 17 — Phone Mirror start-session / modes / status protocol.
 *
 * Covers:
 *   - parsePhoneCommand accepts new command shapes; rejects invalid modes:set
 *   - resolveModesSetCommand fails cleanly for unknown modeId
 *   - connect-time status StreamEvent includes session/stealth/mode fields
 *   - existing chat/action/screenshot/stealth commands still parse
 *   - ipcHandlers wires start-session + modes + status provider / publishStatus
 */
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

const compiledServicePath = path.resolve(
  repoRoot,
  'dist-electron/electron/services/PhoneMirrorService.js',
);
const compiledCommandsPath = path.resolve(
  repoRoot,
  'dist-electron/electron/services/phoneMirrorCommands.js',
);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-session-'));

const electronStub = {
  app: {
    isReady: () => true,
    getPath: () => userDataDir,
    whenReady: () => Promise.resolve(),
    on: () => {},
  },
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
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let PhoneMirrorService;
let parsePhoneCommand;
let resolveModesSetCommand;

before(async () => {
  const svc = await import(pathToFileURL(compiledServicePath).href);
  PhoneMirrorService = svc.PhoneMirrorService;
  const cmds = await import(pathToFileURL(compiledCommandsPath).href);
  parsePhoneCommand = cmds.parsePhoneCommand;
  resolveModesSetCommand = cmds.resolveModesSetCommand;
});

after(() => {
  Module._load = originalLoad;
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
});

describe('parsePhoneCommand — ticket 17 shapes', () => {
  test('accepts start-session', () => {
    assert.deepEqual(parsePhoneCommand({ type: 'start-session' }), {
      type: 'start-session',
    });
  });

  test('accepts modes list + set', () => {
    assert.deepEqual(parsePhoneCommand({ type: 'modes', op: 'list' }), {
      type: 'modes',
      op: 'list',
    });
    assert.deepEqual(
      parsePhoneCommand({ type: 'modes', op: 'set', modeId: 'mode_abc' }),
      { type: 'modes', op: 'set', modeId: 'mode_abc' },
    );
  });

  test('rejects invalid modes:set payloads', () => {
    assert.equal(parsePhoneCommand({ type: 'modes', op: 'set' }), null);
    assert.equal(parsePhoneCommand({ type: 'modes', op: 'set', modeId: '' }), null);
    assert.equal(
      parsePhoneCommand({ type: 'modes', op: 'set', modeId: 'bad id!' }),
      null,
    );
    assert.equal(parsePhoneCommand({ type: 'modes', op: 'delete' }), null);
  });

  test('existing commands still parse', () => {
    assert.equal(parsePhoneCommand({ type: 'chat', message: 'hi' }).type, 'chat');
    assert.equal(parsePhoneCommand({ type: 'action', action: 'whatToAnswer' }).type, 'action');
    assert.equal(parsePhoneCommand({ type: 'screenshot' }).type, 'screenshot');
    assert.deepEqual(parsePhoneCommand({ type: 'two-device-stealth', op: 'enter' }), {
      type: 'two-device-stealth',
      op: 'enter',
    });
  });
});

describe('resolveModesSetCommand', () => {
  const modes = [{ id: 'a' }, { id: 'b' }];

  test('ok for known mode', () => {
    assert.deepEqual(resolveModesSetCommand('a', modes), { ok: true, modeId: 'a' });
  });

  test('fails cleanly for unknown mode', () => {
    assert.deepEqual(resolveModesSetCommand('nope', modes), {
      ok: false,
      message: 'Unknown mode: nope',
    });
  });

  test('fails cleanly for empty modeId', () => {
    assert.deepEqual(resolveModesSetCommand('  ', modes), {
      ok: false,
      message: 'modeId is required',
    });
  });
});

describe('connect-time status StreamEvent', () => {
  async function freshService() {
    const svc = PhoneMirrorService.getInstance();
    if (svc.isRunning()) await svc.stop({ persist: false });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    return { svc, info };
  }

  after(async () => {
    try {
      const svc = PhoneMirrorService.getInstance();
      if (svc.isRunning()) await svc.stop({ persist: false });
    } catch {}
  });

  test('WS connect sends status with session/stealth/mode after history', async () => {
    const { svc, info } = await freshService();
    svc.setStatusProvider(() => ({
      sessionActive: true,
      stealthActive: true,
      modeId: 'mode_1',
      modes: [
        { id: 'mode_1', name: 'Interview', templateType: 'looking-for-work' },
        { id: 'mode_2', name: 'General', templateType: 'general' },
      ],
    }));
    assert.equal(info.running, true);
    assert.ok(info.token);

    const frames = [];
    await new Promise((resolve, reject) => {
      const ws = new WS(`ws://127.0.0.1:${info.port}/ws?t=${encodeURIComponent(info.token)}`);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error('timed out waiting for status frame'));
      }, 5000);
      ws.on('message', (data) => {
        try {
          frames.push(JSON.parse(String(data)));
        } catch {
          return;
        }
        if (frames.some((f) => f.type === 'status')) {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {}
          resolve();
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert.equal(frames[0]?.type, 'history');
    const status = frames.find((f) => f.type === 'status');
    assert.ok(status, 'expected connect-time status event');
    assert.equal(status.sessionActive, true);
    assert.equal(status.stealthActive, true);
    assert.equal(status.modeId, 'mode_1');
    assert.ok(Array.isArray(status.modes));
    assert.equal(status.modes.length, 2);
    assert.equal(status.modes[0].name, 'Interview');
  });

  test('publishStatus broadcasts status to connected phones', async () => {
    const { svc, info } = await freshService();
    let stealth = false;
    svc.setStatusProvider(() => ({
      sessionActive: false,
      stealthActive: stealth,
      modeId: null,
      modes: [],
    }));

    const received = [];
    const ws = new WS(`ws://127.0.0.1:${info.port}/ws?t=${encodeURIComponent(info.token)}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('open timeout')), 5000);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on('error', reject);
    });
    // Drain connect-time frames, then listen for publishStatus.
    await new Promise((r) => setTimeout(r, 50));
    ws.on('message', (data) => {
      try {
        received.push(JSON.parse(String(data)));
      } catch {}
    });

    stealth = true;
    svc.publishStatus({ includeModes: false });
    await new Promise((r) => setTimeout(r, 80));

    const status = received.find((f) => f.type === 'status' && f.stealthActive === true);
    assert.ok(status, 'expected published status with stealthActive');
    assert.equal(status.sessionActive, false);
    assert.equal(status.modes, undefined);

    try {
      ws.close();
    } catch {}
  });
});

describe('ipcHandlers wiring (source contract)', () => {
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

  test('registers status provider and routes start-session + modes', () => {
    assert.match(ipc, /setStatusProvider/);
    assert.match(ipc, /cmd\.type === 'start-session'/);
    assert.match(ipc, /cmd\.type === 'modes'/);
    assert.match(ipc, /appState\.startMeeting/);
    assert.match(ipc, /resolveModesSetCommand/);
    assert.match(ipc, /applyModesSetActive/);
    assert.match(ipc, /publishStatus/);
  });

  test('stealth path still acks and now publishes status', () => {
    const start = ipc.indexOf("cmd.type === 'two-device-stealth'");
    assert.ok(start >= 0);
    const slice = ipc.slice(start, start + 2000);
    assert.match(slice, /publishAck\(`two-device-stealth:\$\{result\.action\}`/);
    assert.match(slice, /publishStatus/);
  });
});
