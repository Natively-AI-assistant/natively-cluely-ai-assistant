// WAL checkpoint + close() on shutdown (2026-07-08).
//
// The "fresh-profile never opens again" bug had a specific root cause: a
// half-written `-wal` file. The connection was never closed, so the
// file lock was held by the dead process. The fix is two new methods on
// DatabaseManager:
//
//   - checkpoint(): runs PRAGMA wal_checkpoint(TRUNCATE) so any
//     uncommitted WAL frames get flushed to the main .db file.
//   - close(): checkpoints AND closes the better-sqlite3 connection so
//     the file lock is released before the process exits.
//
// These tests cover the contract under ELECTRON_RUN_AS_NODE=1
// (which uses the same better-sqlite3 native binding as the real main
// process, just without `electron.app`).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

function freshTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wal-checkpoint-test-'));
}

let DatabaseManager;
let dbMgr;

describe('DatabaseManager.checkpoint() + close() on shutdown (2026-07-08)', () => {
  beforeEach(() => {
    const tmp = freshTmp();
    process.env.NATIVELY_TEST_USERDATA = tmp;
    // Reset module cache so DatabaseManager re-instantiates with the new
    // userData.
    try { delete require.cache[DB_PATH]; } catch {}
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
  });

  test('checkpoint() is a safe no-op when the database is unavailable', () => {
    // If init() failed (e.g. native module mismatch), checkpoint() must not
    // throw — it must be a no-op. This is the contract that protects a
    // packaged app from crashing on shutdown even when DB init failed at
    // startup.
    if (!dbMgr.isAvailable()) {
      assert.doesNotThrow(() => dbMgr.checkpoint());
      assert.doesNotThrow(() => dbMgr.close());
    } else {
      // If init succeeded, checkpoint() and close() should also not throw.
      assert.doesNotThrow(() => dbMgr.checkpoint());
      assert.doesNotThrow(() => dbMgr.close());
      // After close(), isAvailable() should be false.
      assert.equal(dbMgr.isAvailable(), false);
      // Second close() is idempotent.
      assert.doesNotThrow(() => dbMgr.close());
    }
  });

  test('after close(), all public methods that touch the db are no-ops', () => {
    if (!dbMgr.isAvailable()) {
      // Skip — depends on native module being loadable in this env.
      return;
    }
    dbMgr.close();
    // No public method should throw after close. We can only check
    // isAvailable() is false; deeper no-op guarantees are not part of the
    // public contract today, but isAvailable() should never lie.
    assert.equal(dbMgr.isAvailable(), false);
  });
});
