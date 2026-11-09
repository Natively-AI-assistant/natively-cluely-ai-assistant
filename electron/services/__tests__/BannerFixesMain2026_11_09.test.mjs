// The main-process halves of the 2026-11-09 banner fixes.
//
// - L2: the permissions card's closes are kept in main (SettingsManager
//   `permissionsCard`, permissions-card:get / permissions-card:record), so they
//   survive restarts and updates whatever origin the renderer has.
// - L6: HindsightManager keeps the last lifecycle status it broadcast, and
//   hindsight:get-status hands it to a window that subscribed late.
// - L8: a review left from About retires the review card in the card ledger at
//   once (review:submit), not at the next launch's backend sync.
//
// Executes the compiled services (dist-electron) behind a fake electron, plus
// source-level checks of the handlers (ipcHandlers.ts registers hundreds).
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test electron/services/__tests__/BannerFixesMain2026_11_09.test.mjs
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ipc = fs.readFileSync(path.join(ROOT, 'electron/ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');

let userData;
let sent = [];
let CardLedger, settleReviewCard, ReviewService, HindsightManager;

before(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'banner-fixes-'));
  const noop = () => {};
  const fakeWindow = { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false, isReady: () => true,
      getVersion: () => '0.0.0-test', getName: () => 'natively',
      on: noop, once: noop, off: noop, removeAllListeners: noop, whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [fakeWindow] }),
    ipcMain: { handle: noop, on: noop, removeHandler: noop },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {}, dialog: {}, screen: { on: noop }, nativeTheme: { on: noop },
  };
  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, ...rest);
  };
  ({ CardLedger } = require(path.join(ROOT, 'dist-electron/electron/services/cards/CardLedger.js')));
  ({ settleReviewCard } = require(path.join(ROOT, 'dist-electron/electron/services/cards/mainLegacy.js')));
  ({ ReviewService } = require(path.join(ROOT, 'dist-electron/electron/services/ReviewService.js')));
  ({ HindsightManager } = require(path.join(ROOT, 'dist-electron/electron/services/HindsightManager.js')));
});

describe('L8: a review left from About retires the review card now', () => {
  test('after markReviewed, the review ledger retires the card as acted', () => {
    const ledger = new CardLedger(path.join(fs.mkdtempSync(path.join(userData, 'l-')), 'card-ledger.json'));
    const svc = ReviewService.getInstance();
    svc.markReviewed('rev_about_1');
    const after = settleReviewCard(ledger, svc.getLocalState());
    assert.equal(after?.cards.review_prompt.retired, true);
    assert.equal(after?.cards.review_prompt.retiredReason, 'acted');
  });

  test('review:submit settles the card and tells every window, only on a stored review', () => {
    const block = sliceSafeHandleBlock(ipc, 'review:submit');
    const ok = block.indexOf('if (result.ok && result.id) {');
    assert.notEqual(ok, -1);
    const settle = block.indexOf('settleReviewCardNow(svc.getLocalState());');
    assert.ok(settle > block.indexOf('svc.markReviewed(result.id);', ok), 'after the review ledger is updated');
    const helper = ipc.slice(ipc.indexOf('const settleReviewCardNow = '), ipc.indexOf("safeHandle('review:dismiss-forever'"));
    assert.match(helper, /settleReviewCard\(CardLedger\.getInstance\(\)/);
    assert.match(helper, /win\.webContents\.send\('cards:changed', ledger\)/);
    assert.match(helper, /catch \(e: any\)/, 'a ledger failure never fails the submit');
  });
});

describe('L6: the last Hindsight status is kept for a late window', () => {
  test('broadcastStatus keeps what it sent', () => {
    const hm = HindsightManager.getInstance();
    sent = [];
    hm.broadcastStatus('spawn-failed', 'server exited with code 1');
    const last = hm.getLastStatus();
    assert.equal(last.state, 'spawn-failed');
    assert.equal(last.reason, 'server exited with code 1');
    assert.deepEqual(sent.at(-1), { channel: 'hindsight-status', payload: last });
    hm.noteStatus({ state: 'ready', reason: 'disabled by user', at: 1 });
    assert.equal(hm.getLastStatus().state, 'ready');
  });

  test('hindsight:get-status is registered and bridged', () => {
    assert.match(sliceSafeHandleBlock(ipc, 'hindsight:get-status'), /getLastStatus\(\)/);
    assert.match(preload, /ipcRenderer\.invoke\('hindsight:get-status'\)/);
  });
});

describe('L2: the permissions card record lives in main', () => {
  test('permissions-card:get reads the stored record through the policy', () => {
    const block = sliceSafeHandleBlock(ipc, 'permissions-card:get');
    assert.match(block, /normalizePermissionsCardRecord\(SettingsManager\.getInstance\(\)\.get\('permissionsCard'\)\)/);
  });

  test('permissions-card:record accepts only its two events and reports a refused write', () => {
    const block = sliceSafeHandleBlock(ipc, 'permissions-card:record');
    assert.match(block, /if \(event !== 'dismissed' && event !== 'granted'\) return \{ success: false, error: 'invalid_event' \};/);
    assert.match(block, /applyPermissionsCardEvent\(sm\.get\('permissionsCard'\), event, Date\.now\(\)\)/);
    assert.match(block, /if \(!sm\.set\('permissionsCard', record\)\) return \{ success: false, error: 'settings_store_degraded' \};/);
  });

  test('both are bridged in preload', () => {
    assert.match(preload, /permissionsCardGet: \(\) => ipcRenderer\.invoke\('permissions-card:get'\)/);
    assert.match(preload, /permissionsCardRecord: \(event: 'dismissed' \| 'granted'\) => ipcRenderer\.invoke\('permissions-card:record', event\)/);
  });
});
