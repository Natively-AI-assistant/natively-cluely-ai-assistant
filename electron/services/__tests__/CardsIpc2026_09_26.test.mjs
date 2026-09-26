// The card ledger over IPC (toaster policy Phase 1).
//
// The renderer records card outcomes and imports its legacy history through
// these handlers; anything it sends is untrusted, so an unknown card, an
// unknown outcome or a malformed payload must be refused without writing.
// Executes the real handlers out of the compiled bundle (harness from
// TrialEndsOnlyOnPurchaseOrByok2026_09_25.test.mjs).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const handlers = new Map();
let sends = [];
let userData;
const ledgerFile = () => path.join(userData, 'card-ledger.json');
const disk = () => JSON.parse(fs.readFileSync(ledgerFile(), 'utf8'));

before(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-ipc-'));
  // The review ledger main imports from (ReviewService's review-state.json).
  fs.writeFileSync(path.join(userData, 'review-state.json'), JSON.stringify({ has_reviewed: true, dont_show_again: false }));
  const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sends.push({ channel, data }) } };
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false, isReady: () => true,
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
  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, ...rest);
  };
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });
  const mod = require(path.join(ROOT, 'dist-electron/electron/ipcHandlers.js'));
  const appState = {
    processingHelper: { getLLMHelper: () => ({ setModel: noop, setNativelyKey: noop, getCodexCliConfig: () => ({ enabled: false }) }) },
    sendModelChanged: noop, reconfigureSttProvider: async () => {}, getKnowledgeOrchestrator: () => null,
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring only */ }
});

describe('cards:record', () => {
  test('a valid outcome is saved and every window is told', async () => {
    sends = [];
    const res = await handlers.get('cards:record')({}, 'support', 'later');
    assert.equal(res.ok, true);
    assert.equal(disk().cards.support.strikes, 1);
    const changed = sends.filter((s) => s.channel === 'cards:changed');
    assert.equal(changed.length, 1);
    assert.equal(changed[0].data.cards.support.strikes, 1);
  });

  test('an unknown card is refused and nothing is written', async () => {
    const before = fs.readFileSync(ledgerFile(), 'utf8');
    assert.deepEqual(await handlers.get('cards:record')({}, 'popup_of_doom', 'later'), { ok: false, error: 'unknown_card' });
    assert.deepEqual(await handlers.get('cards:record')({}, { id: 'support' }, 'later'), { ok: false, error: 'unknown_card' });
    assert.equal(fs.readFileSync(ledgerFile(), 'utf8'), before);
  });

  test('an unknown outcome is refused and nothing is written', async () => {
    const before = fs.readFileSync(ledgerFile(), 'utf8');
    assert.deepEqual(await handlers.get('cards:record')({}, 'support', 'maybe'), { ok: false, error: 'unknown_outcome' });
    assert.equal(fs.readFileSync(ledgerFile(), 'utf8'), before);
  });

  test('Max/Ultra "acted" carries the cycle end; a bad meta is ignored', async () => {
    const until = Date.now() + 10 * 86_400_000;
    await handlers.get('cards:record')({}, 'max_ultra', 'acted', { until });
    assert.equal(disk().cards.max_ultra.retiredUntil, until);
    await handlers.get('cards:record')({}, 'jd_ad', 'acted', { until: 'soon' });
    assert.equal(disk().cards.jd_ad.retired, true);
  });
});

describe('cards:get', () => {
  test('returns the ledger', async () => {
    const res = await handlers.get('cards:get')({});
    assert.equal(res.ok, true);
    assert.equal(res.ledger.version, 1);
    assert.equal(res.ledger.cards.support.strikes, 1);
  });
});

describe('cards:import-legacy', () => {
  test('a malformed payload is refused', async () => {
    assert.deepEqual(await handlers.get('cards:import-legacy')({}, 'dismissed'), { ok: false, error: 'invalid_legacy' });
    assert.deepEqual(await handlers.get('cards:import-legacy')({}, ['jd']), { ok: false, error: 'invalid_legacy' });
    assert.equal(disk().imported.renderer, undefined);
  });

  test('the renderer history is imported once', async () => {
    const first = await handlers.get('cards:import-legacy')({}, { dismissedAds: ['profile'] });
    assert.equal(first.ok, true);
    assert.equal(disk().cards.profile_ad.retired, true);
    await handlers.get('cards:import-legacy')({}, { dismissedAds: ['jd'] });
    assert.equal(disk().cards.jd_ad.retiredReason, 'acted', 'the second import changed nothing');
  });
});

describe('main-side legacy', () => {
  test('gatherMainLegacy reads the review ledger and the trial claim', () => {
    const cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js')).CredentialsManager.getInstance();
    cm.setTrialToken('trial_tok_test', new Date(Date.now() - 60_000).toISOString(), new Date().toISOString());
    const { gatherMainLegacy } = require(path.join(ROOT, 'dist-electron/electron/services/cards/mainLegacy.js'));
    const legacy = gatherMainLegacy();
    assert.equal(legacy.reviewed, true);
    assert.equal(legacy.trialClaimed, true);
  });
});
