// The review card follows the review, wherever it happened, and a network
// blip gets one quiet retry (toaster policy Phase 3, spec §6 rows 11-13).
//
// - A review (or "Never ask") from another install reaches this one only via
//   ReviewService.syncWithBackend, which is async and lands AFTER the card
//   ledger's one-time import. It used to be lost: the review card could ask
//   someone who had already reviewed.
// - submitReview returned the raw fetch message on a network error (not a
//   code the modal knows, so the user got the generic copy) and never retried.
//
// Executes the compiled services (dist-electron) behind a fake electron.
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test electron/services/__tests__/ReviewCardSync2026_09_26.test.mjs
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let userData;
let CardLedger, reviewCardOutcome, settleReviewCard, ReviewService;

before(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'review-card-sync-'));
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false, isReady: () => true,
      getVersion: () => '0.0.0-test', getName: () => 'natively',
      on: noop, once: noop, off: noop, removeAllListeners: noop, whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [] }),
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
  ({ reviewCardOutcome, settleReviewCard } = require(path.join(ROOT, 'dist-electron/electron/services/cards/mainLegacy.js')));
  ({ ReviewService } = require(path.join(ROOT, 'dist-electron/electron/services/ReviewService.js')));
});

const freshLedger = () => new CardLedger(path.join(fs.mkdtempSync(path.join(userData, 'l-')), 'card-ledger.json'));

describe('the review card follows the review', () => {
  test('reviewCardOutcome', () => {
    assert.equal(reviewCardOutcome({ has_reviewed: true }), 'acted');
    assert.equal(reviewCardOutcome({ dont_show_again: true }), 'never');
    assert.equal(reviewCardOutcome({ has_reviewed: true, dont_show_again: true }), 'acted');
    assert.equal(reviewCardOutcome({ has_reviewed: false, dont_show_again: false }), null);
    assert.equal(reviewCardOutcome(null), null);
  });

  test('a review from another install retires the card', () => {
    const ledger = freshLedger();
    const after = settleReviewCard(ledger, { has_reviewed: true });
    assert.equal(after?.cards.review_prompt.retired, true);
    assert.equal(ledger.get().cards.review_prompt.retiredReason, 'acted');
  });

  test('a retired card is left alone, and nothing new is nothing to do', () => {
    const ledger = freshLedger();
    settleReviewCard(ledger, { dont_show_again: true });
    assert.equal(settleReviewCard(ledger, { has_reviewed: true }), null, 'already retired');
    assert.equal(ledger.get().cards.review_prompt.retiredReason, 'never');
    assert.equal(settleReviewCard(freshLedger(), {}), null);
  });

  test('main settles the card once the backend sync has landed', () => {
    const main = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8');
    const sync = main.slice(main.indexOf('reviewService.syncWithBackend(apiKey, hwid)'), main.indexOf('.catch(() => {});', main.indexOf('reviewService.syncWithBackend(apiKey, hwid)')));
    assert.ok(sync.includes('settleReviewCard(CardLedger.getInstance(), reviewService.getLocalState())'));
    assert.ok(sync.includes("win.webContents.send('cards:changed', ledger)"));
  });
});

describe('submitReview: one quiet retry on a network error', () => {
  const payload = { rating: 5, review_text: null, app_version: '0', platform: 'darwin', build_channel: 'dev', email: null };
  const okReply = { ok: true, status: 200, json: async () => ({ ok: true, id: 'rev_1' }) };

  test('fails twice: reported as network_error, after exactly two attempts', async () => {
    ReviewService.NETWORK_RETRY_MS = 0;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed'); };
    const res = await ReviewService.getInstance().submitReview(null, 'hw', payload);
    assert.deepEqual(res, { ok: false, error: 'network_error' });
    assert.equal(calls, 2);
  });

  test('fails once: the retry goes through', async () => {
    ReviewService.NETWORK_RETRY_MS = 0;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; if (calls === 1) throw new TypeError('fetch failed'); return okReply; };
    const res = await ReviewService.getInstance().submitReview(null, 'hw', payload);
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
  });

  test('a timeout is not retried: the user already waited', async () => {
    ReviewService.NETWORK_RETRY_MS = 0;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
    const res = await ReviewService.getInstance().submitReview(null, 'hw', payload);
    assert.deepEqual(res, { ok: false, error: 'network_error' });
    assert.equal(calls, 1);
  });
});
