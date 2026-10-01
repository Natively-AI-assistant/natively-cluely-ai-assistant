// The card-ledger half of the one-time trial campaign (src/lib/trialCampaign.mjs):
// reopenCard() and CardLedger.reopen() bring a retired trial promo back, keep its
// show history so promotional spacing still applies, persist across restarts, and
// refuse (rather than pretend) while the ledger file cannot be read. Constructed
// directly with a temp file and a fake clock; no Electron needed, and the same
// file API runs on macOS and Windows.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/TrialPromoReopen2026_09_29.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const T0 = Date.UTC(2026, 8, 1);
const D = 86_400_000;

let CardLedger;
let policy;
let dir;
before(async () => {
  ({ CardLedger } = require(path.join(ROOT, 'dist-electron/electron/services/cards/CardLedger.js')));
  policy = await import(path.join(ROOT, 'src/lib/cards/cardPolicy.mjs'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-reopen-'));
});
const fileFor = (name) => path.join(dir, name, 'card-ledger.json');

test('reopenCard un-retires the card whichever way it was retired', () => {
  for (const outcome of ['never', 'acted']) {
    let l = policy.applyOutcome(policy.emptyLedger(T0), 'trial_promo', outcome, T0);
    assert.equal(policy.entryOf(l, 'trial_promo').retired, true, `precondition (${outcome})`);
    l = policy.reopenCard(l, 'trial_promo');
    const e = policy.entryOf(l, 'trial_promo');
    assert.equal(e.retired, false);
    assert.equal(e.retiredReason, null);
    assert.equal(policy.isCardAvailable(l, 'trial_promo', T0 + 30 * D), true);
  }
});

test('reopenCard clears strikes and the waiting period, and keeps the show history', () => {
  let l = policy.emptyLedger(T0);
  l = policy.applyOutcome(l, 'trial_promo', 'shown', T0);
  l = policy.applyOutcome(l, 'trial_promo', 'later', T0);
  l = policy.applyOutcome(l, 'trial_promo', 'later', T0 + 8 * D);
  assert.equal(policy.entryOf(l, 'trial_promo').strikes, 2, 'precondition');
  const after = policy.entryOf(policy.reopenCard(l, 'trial_promo'), 'trial_promo');
  assert.equal(after.strikes, 0);
  assert.equal(after.nextEligibleAt, null);
  assert.equal(after.shows, 1, 'shows are history, not state to reset');
  assert.equal(after.lastShownAt, T0);
});

test('reopenCard touches only the named card and never mutates its input', () => {
  let l = policy.applyOutcome(policy.emptyLedger(T0), 'trial_promo', 'never', T0);
  l = policy.applyOutcome(l, 'support', 'never', T0);
  const snapshot = JSON.stringify(l);
  const out = policy.reopenCard(l, 'trial_promo');
  assert.equal(JSON.stringify(l), snapshot, 'input untouched');
  assert.equal(policy.entryOf(out, 'support').retired, true, 'another retired card stays retired');
});

test('reopenCard refuses an unknown card', () => {
  assert.throws(() => policy.reopenCard(policy.emptyLedger(T0), 'not_a_card'), /unknown card/);
});

test('CardLedger.reopen persists, and survives a restart', () => {
  const file = fileFor('persist');
  const a = new CardLedger(file, () => T0);
  a.record('trial_promo', 'never');
  assert.equal(a.get().cards.trial_promo.retired, true, 'precondition');
  assert.ok(a.reopen('trial_promo'));
  const b = new CardLedger(file, () => T0 + D);
  assert.equal(b.get().cards.trial_promo.retired, false);
});

test('CardLedger.reopen on an unreadable ledger returns null and writes nothing', () => {
  const file = fileFor('unreadable');
  fs.mkdirSync(file, { recursive: true }); // a directory where the file belongs: existsSync true, read throws
  const l = new CardLedger(file, () => T0);
  assert.equal(l.isReadable(), false, 'precondition');
  assert.equal(l.reopen('trial_promo'), null, 'the caller must not record a reset that did not happen');
  assert.equal(fs.statSync(file).isDirectory(), true, 'the unreadable path was not replaced');
});

test('after the campaign, the trial promo is eligible again where a plain retire would not be', () => {
  const file = fileFor('promo');
  const l = new CardLedger(file, () => T0);
  l.record('trial_promo', 'acted');
  assert.equal(policy.isCardAvailable(l.get(), 'trial_promo', T0 + 30 * D), false, 'precondition: retired');
  l.reopen('trial_promo');
  assert.equal(policy.isCardAvailable(l.get(), 'trial_promo', T0 + 30 * D), true);
});
