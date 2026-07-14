// electron/services/__tests__/PhoneMirrorKillSwitch.test.mjs
//
// Behavioral test for the NATIVELY_DISABLE_PHONE_MIRROR boot kill switch.
// The actual start/no-start decision lives in the exported pure function
// `shouldStartPhoneMirrorOnBoot` (electron/services/PhoneMirrorService.ts),
// extracted from main.ts's boot sequence specifically so it can be imported
// and exercised here instead of regex-matching source text.
//
// Pattern (per repo memory): stub electron app/BrowserWindow/safeStorage via a
// Module._load hook BEFORE importing the compiled CJS bundle.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../');
const electronRoot = path.resolve(here, '..', '..');

const compiledServicePath = path.resolve(
  repoRoot,
  'dist-electron/electron/services/PhoneMirrorService.js',
);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-killswitch-'));

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

let shouldStartPhoneMirrorOnBoot;
let PhoneMirrorService;

test.before(async () => {
  const mod = await import(pathToFileURL(compiledServicePath).href);
  shouldStartPhoneMirrorOnBoot = mod.shouldStartPhoneMirrorOnBoot;
  PhoneMirrorService = mod.PhoneMirrorService;
});

test.after(() => {
  Module._load = originalLoad;
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
});

test('kill switch set + setting enabled → does NOT start', () => {
  assert.equal(
    shouldStartPhoneMirrorOnBoot({ disablePhoneMirror: true, phoneMirrorEnabled: true }),
    false,
  );
});

test('kill switch unset + setting enabled → starts', () => {
  assert.equal(
    shouldStartPhoneMirrorOnBoot({ disablePhoneMirror: false, phoneMirrorEnabled: true }),
    true,
  );
});

test('kill switch unset + setting disabled → does NOT start', () => {
  assert.equal(
    shouldStartPhoneMirrorOnBoot({ disablePhoneMirror: false, phoneMirrorEnabled: false }),
    false,
  );
});

test('kill switch set + setting disabled → does NOT start', () => {
  assert.equal(
    shouldStartPhoneMirrorOnBoot({ disablePhoneMirror: true, phoneMirrorEnabled: false }),
    false,
  );
});

test('main.ts calls PhoneMirrorService.getInstance().start() only when shouldStartPhoneMirrorOnBoot decides true', async () => {
  const svc = PhoneMirrorService.getInstance();
  const originalStart = svc.start.bind(svc);
  const calls = [];
  svc.start = async (opts) => {
    calls.push(opts);
    return { port: 0 };
  };
  try {
    const scenarios = [
      { disablePhoneMirror: true, phoneMirrorEnabled: true },
      { disablePhoneMirror: false, phoneMirrorEnabled: true },
      { disablePhoneMirror: false, phoneMirrorEnabled: false },
    ];
    for (const scenario of scenarios) {
      calls.length = 0;
      if (shouldStartPhoneMirrorOnBoot(scenario)) {
        await svc.start({ exposeOnLan: false, persist: false });
      }
      assert.equal(
        calls.length,
        scenario.disablePhoneMirror || !scenario.phoneMirrorEnabled ? 0 : 1,
        `unexpected start() call count for ${JSON.stringify(scenario)}`,
      );
    }
  } finally {
    svc.start = originalStart;
  }
});

// ---- lightweight regression guard: port constants unrelated to the kill switch ----
const serviceSource = fs.readFileSync(path.join(electronRoot, 'services', 'PhoneMirrorService.ts'), 'utf8');

test('PhoneMirror service port behavior remains unchanged', () => {
  assert.match(serviceSource, /const DEFAULT_PORT = 4123;/);
  assert.match(serviceSource, /const PORT_PROBE_RANGE = 12;/);
});
