// The card ledger file in the main process (toaster policy Phase 1).
//
// It is the one source of truth for how often each onboarding/promotional
// card was shown, its strikes and retirements, so it must survive restarts,
// crashes mid-write and a hand-edited or corrupt file — a corrupt ledger may
// never stop the app from starting. Constructed directly with a temp file and
// a fake clock; no Electron needed.
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
let dir;
before(() => {
  ({ CardLedger } = require(path.join(ROOT, 'dist-electron/electron/services/cards/CardLedger.js')));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-ledger-'));
});
const fileFor = (name) => path.join(dir, name, 'card-ledger.json');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a new ledger starts at the first launch, and the folder is created on save', () => {
  const file = fileFor('fresh');
  const l = new CardLedger(file, () => T0);
  assert.equal(l.get().firstLaunchAt, T0);
  l.recordLaunch();
  assert.equal(read(file).launchCount, 1);
});

test('outcomes persist across instances (restarts)', () => {
  const file = fileFor('persist');
  new CardLedger(file, () => T0).record('support', 'later');
  const again = new CardLedger(file, () => T0 + D);
  assert.equal(again.get().cards.support.strikes, 1);
  assert.equal(again.get().cards.support.nextEligibleAt, T0 + 7 * D);
});

test('saves are atomic: no temp file is left behind', () => {
  const file = fileFor('atomic');
  new CardLedger(file, () => T0).record('jd_ad', 'shown');
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('a corrupt file never blocks startup: fresh ledger, bad file kept as .bak', () => {
  const file = fileFor('corrupt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"version":1,"cards":');
  const l = new CardLedger(file, () => T0 + 5 * D);
  assert.equal(l.get().firstLaunchAt, T0 + 5 * D);
  assert.deepEqual(l.get().cards, {});
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), '{"version":1,"cards":');
});

test('a file with the wrong shape is treated like a corrupt one', () => {
  const file = fileFor('shape');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hello: 'world' }));
  const l = new CardLedger(file, () => T0);
  assert.equal(l.get().version, 1);
  assert.equal(fs.existsSync(file + '.bak'), true);
});

test('each legacy source is imported once', () => {
  const file = fileFor('legacy');
  const l = new CardLedger(file, () => T0);
  l.importLegacy('main', { reviewed: true });
  assert.equal(l.get().cards.review_prompt.retired, true);
  l.importLegacy('main', { donated: true });
  assert.equal(l.get().cards.support, undefined, 'a second main import is a no-op');
  l.importLegacy('renderer', { donated: true });
  assert.equal(l.get().cards.support.retired, true, 'a different source still imports');
  assert.deepEqual(Object.keys(read(file).imported).sort(), ['main', 'renderer']);
});

test('two records in a row both land', () => {
  const file = fileFor('two');
  const l = new CardLedger(file, () => T0);
  l.record('support', 'later');
  l.record('jd_ad', 'never');
  const disk = read(file);
  assert.equal(disk.cards.support.strikes, 1);
  assert.equal(disk.cards.jd_ad.retired, true);
});

test('an unknown card is rejected and nothing is written', () => {
  const file = fileFor('reject');
  const l = new CardLedger(file, () => T0);
  l.record('support', 'shown');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => l.record('nope', 'later'), /unknown card/);
  assert.throws(() => l.record('support', 'meh'), /unknown outcome/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// Review finding (2026-09-26): an I/O error is not corruption. On Windows an
// antivirus scanner can hold the file at startup; treating that like a corrupt
// file overwrote the real ledger (strikes, "never") once the lock cleared.
test('a ledger that cannot be READ is left alone, and reports itself unavailable', () => {
  const file = fileFor('unreadable');
  // A directory where the file should be: existsSync is true, readFileSync
  // throws EISDIR — an I/O error, like a file an antivirus scanner holds.
  fs.mkdirSync(file, { recursive: true });
  const l = new CardLedger(file, () => T0);
  l.recordLaunch();
  assert.equal(l.isReadable(), false, 'the scheduler must not run on an empty stand-in');
  assert.throws(() => l.record('support', 'later'), /ledger_unreadable/);
  assert.equal(fs.statSync(file).isDirectory(), true, 'the unreadable path was not replaced');
  assert.equal(fs.existsSync(file + '.bak'), false, 'an I/O error is not corruption');
});

test('once the lock clears, the real ledger is adopted with this session\'s launches', () => {
  const file = fileFor('recovers');
  fs.mkdirSync(file, { recursive: true });
  const l = new CardLedger(file, () => T0);
  l.recordLaunch();
  // The lock clears: the real file is readable again.
  fs.rmSync(file, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1, firstLaunchAt: T0 - 9 * D, launchCount: 7, lastPromoShownAt: null, imported: { main: 1 },
    cards: { jd_ad: { retired: true, retiredReason: 'never' } },
  }));
  assert.equal(l.isReadable(), true);
  assert.equal(l.get().cards.jd_ad.retired, true, 'the user\'s "never" survives');
  assert.equal(l.get().launchCount, 8, 'the launch counted while locked is kept');
  l.record('support', 'later');
  assert.equal(read(file).cards.jd_ad.retired, true);
  assert.equal(read(file).cards.support.strikes, 1);
});
