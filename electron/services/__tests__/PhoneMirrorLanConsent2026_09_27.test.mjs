// phone-mirror:enable used to bind 0.0.0.0 without the "Allow LAN access?"
// consent the LAN switch requires (setExposeOnLan). Both now share one rule:
// a LAN bind needs consent once per app run. A saved phoneMirrorExposeOnLan is
// not consent, because _start() persists whatever it was handed.
//
// Same harness as PhoneMirrorBrowserContextV2: electron stubbed via
// Module._load, the compiled service loaded from dist-electron. Nothing here
// starts a server on the LAN.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const compiledServicePath = path.resolve(repoRoot, 'dist-electron/electron/services/PhoneMirrorService.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-lan-consent-test-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class { static getAllWindows() { return []; } static getFocusedWindow() { return null; } },
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

let svc;
before(async () => {
  const mod = await import(pathToFileURL(compiledServicePath).href);
  svc = mod.PhoneMirrorService.getInstance();
});
after(async () => {
  try { if (svc?.isRunning()) await svc.stop({ persist: false }); } catch {}
  Module._load = originalLoad;
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
});

test('a local-only start never needs LAN consent', () => {
  assert.equal(svc.needsLanBindConfirmation(false), false);
});

test('enabling with LAN on needs consent before anything binds', () => {
  assert.equal(svc.isRunning(), false);
  assert.equal(svc.needsLanBindConfirmation(true), true);
});

test('a LAN start already under way needs no consent: a decline could not stop it', () => {
  // _start() sets exposeOnLan before it binds, so an in-flight boot restore of a
  // saved LAN setting looks like this. Faked through the fields, not a real bind.
  const saved = { starting: svc.starting, exposeOnLan: svc.exposeOnLan };
  try {
    svc.starting = new Promise(() => {});
    svc.exposeOnLan = true;
    assert.equal(svc.needsLanBindConfirmation(true), false);
    svc.exposeOnLan = false; // a local-only start in flight still asks before LAN
    assert.equal(svc.needsLanBindConfirmation(true), true);
  } finally {
    svc.starting = saved.starting;
    svc.exposeOnLan = saved.exposeOnLan;
  }
});

test('the LAN switch path asks for the same consent', async () => {
  await assert.rejects(() => svc.setExposeOnLan(true), (e) => e?.name === 'LANBindConfirmationRequired');
});

test('once allowed this run, neither path asks again', () => {
  svc.markLanBindDialogShown();
  assert.equal(svc.needsLanBindConfirmation(true), false);
});
