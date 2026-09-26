// The screenshot transcription cache, against a REAL sqlite database.
//
// Every other test in this feature stubs the database away, so the v31
// migration and the store's SQL had zero executed coverage. This suite runs the
// real DatabaseManager migration chain against a temp userData and writes
// through the real store — it runs under the electron runner because
// better-sqlite3 is a native module built for Electron's ABI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Must be set before DatabaseManager is first required — it resolves its path
// once, in the constructor.
process.env.NATIVELY_TEST_USERDATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-store-'));

const { DatabaseManager } = require(path.join(root, 'dist-electron/electron/db/DatabaseManager.js'));
const store = require(path.join(root, 'dist-electron/electron/services/screen/ScreenshotDescriptionStore.js'));

const key = (n) => String(n).padStart(64, '0');

test('the v31 migration actually applies, and the store can round-trip through it', () => {
  const dm = DatabaseManager.getInstance();
  assert.equal(dm.isAvailable(), true, dm.getInitError()?.message ?? 'database unavailable');
  const db = dm.getDb();

  assert.ok(
    db.pragma('user_version', { simple: true }) >= 31,
    'v31 did not apply — every earlier migration stops the chain on failure, so this also proves none of them broke',
  );
  assert.ok(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='screenshot_descriptions'").get(),
    'the migration stamped its version without creating its table',
  );

  store.putScreenshotDescription(key(1), 'Errors on screen:\nerror LNK2019', 'gemini', 'g-3.7');
  const row = store.getScreenshotDescription(key(1));
  assert.match(row.description, /LNK2019/);
  assert.equal(row.provider, 'gemini');

  // Re-describing the same screen replaces rather than duplicating.
  store.putScreenshotDescription(key(1), 'a better transcription', 'openai', 'gpt');
  assert.equal(store.getScreenshotDescription(key(1)).description, 'a better transcription');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM screenshot_descriptions WHERE image_sha256 = ?').get(key(1)).c, 1);
});

test('an empty description is never stored, so a failed transcription cannot mask a good one', () => {
  store.putScreenshotDescription(key(2), '   ');
  assert.equal(store.getScreenshotDescription(key(2)), null);
  assert.equal(store.getScreenshotDescription(''), null);
});

test('the row cap is EXACT even when every write lands in the same millisecond', () => {
  const db = DatabaseManager.getInstance().getDb();
  db.prepare('DELETE FROM screenshot_descriptions').run();

  // The realistic burst. `Date.now()` is millisecond resolution, so writes in a
  // loop TIE — and a `created_at < cutoff` prune keeps every tied row. Measured
  // before the fix: 601 writes against a cap of 500 left 514 rows, and in the
  // limit (all rows one millisecond) nothing prunes at all and "bounded by
  // construction" is simply false. The (created_at, rowid) cutoff makes the
  // ordering total.
  const cap = store.MAX_SCREENSHOT_DESCRIPTIONS;
  for (let i = 0; i < cap + 101; i++) store.putScreenshotDescription(key(i), `description ${i}`);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM screenshot_descriptions').get().c, cap);
  // Newest kept, oldest evicted.
  assert.ok(store.getScreenshotDescription(key(cap + 100)), 'the most recent write must survive its own prune');
  assert.equal(store.getScreenshotDescription(key(0)), null, 'the oldest must be gone');
});

test('the prune is an index search, not a table scan on every write', () => {
  const db = DatabaseManager.getInstance().getDb();
  // This runs after every screenshot turn on three paths now, so a full scan
  // here is a per-turn cost. The previous `NOT IN (SELECT … LIMIT n)` form
  // planned as "SCAN screenshot_descriptions" + "CREATE BLOOM FILTER".
  const plan = db.prepare(
    `EXPLAIN QUERY PLAN DELETE FROM screenshot_descriptions WHERE (created_at, rowid) < (
       SELECT created_at, rowid FROM screenshot_descriptions
       ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET ?
     )`,
  ).all(1).map((r) => r.detail).join(' | ');

  assert.match(plan, /SEARCH screenshot_descriptions USING COVERING INDEX/);
  assert.doesNotMatch(plan, /BLOOM FILTER/);
});
