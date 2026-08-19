#!/usr/bin/env node
/**
 * R-05 repro — the v28 migration destroys v27's retry.
 *
 * runMigrations() reads `user_version` ONCE into a const. v27's catch
 * deliberately swallows rather than re-throwing, logging "leaving version at 26
 * to retry next launch". But control then fell into `if (version < 28)` against
 * the STALE snapshot (26); v28 succeeded and stamped user_version = 28. On the
 * next launch `version < 27` was false, so the page-count repair never ran
 * again — silently, forever. The claim in v27's own log line was false, and it
 * was made false by this campaign's own v28 block.
 *
 * Note the fix that does NOT work: re-reading the pragma before the v28 gate.
 * 26 < 28 is still true, so v28 would still run and still stamp 28. A swallowed
 * failure has to STOP the chain.
 *
 * Part 1 executes the control flow against a real SQLite user_version pragma.
 * Part 2 anchors the assertion to the real source so it cannot pass on a copy.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-05-repro.cjs
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'electron', 'db', 'DatabaseManager.ts');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-05] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

// ---------------------------------------------------------------------------
// Part 1 — the control flow, against a real pragma, with v27 forced to fail.
// `stopChainOnSwallowedFailure` models the fix; false models the shipped bug.
// ---------------------------------------------------------------------------
function runMigrations(db, { v27Fails, stopChainOnSwallowedFailure }) {
  const version = db.pragma('user_version', { simple: true }) || 0;   // read ONCE, as in source
  if (version < 27) {
    try {
      if (v27Fails) throw new Error('page-count repair failed');
      db.pragma('user_version = 27');
    } catch (_) {
      if (stopChainOnSwallowedFailure) return;
    }
  }
  if (version < 28) {
    db.pragma('user_version = 28');   // v28 succeeds; nothing here depends on v27
  }
}

const simulate = (opts) => {
  const db = new Database(':memory:');
  db.pragma('user_version = 26');
  runMigrations(db, opts);
  const after = db.pragma('user_version', { simple: true });
  // Second launch: does v27 get another chance?
  const v27RetriedNextLaunch = after < 27;
  db.close();
  return { after, v27RetriedNextLaunch };
};

const buggy = simulate({ v27Fails: true, stopChainOnSwallowedFailure: false });
console.log(`[R-05] SHIPPED behaviour, v27 fails -> user_version=${buggy.after}, v27 retried next launch: ${buggy.v27RetriedNextLaunch}`);

const fixed = simulate({ v27Fails: true, stopChainOnSwallowedFailure: true });
console.log(`[R-05] FIXED   behaviour, v27 fails -> user_version=${fixed.after}, v27 retried next launch: ${fixed.v27RetriedNextLaunch}`);

check('a failed v27 leaves the version below 27', fixed.after, 26);
check('a failed v27 is retried next launch     ', fixed.v27RetriedNextLaunch, true);

// The happy path must be unaffected: v27 succeeds, v28 still runs.
const happy = simulate({ v27Fails: false, stopChainOnSwallowedFailure: true });
check('v27 succeeding still lets v28 run       ', happy.after, 28);

// ---------------------------------------------------------------------------
// Part 2 — anchor to the real source: v27's catch must not fall through.
// ---------------------------------------------------------------------------
const src = fs.readFileSync(SRC, 'utf8');
// Purpose-anchored, not version-pinned: the repair was renumbered once already
// (v27 -> v28 when main's usage_outbox took 27) and a pinned number makes this
// harness false-fail on correct code — the §18.1 pinned-identifier trap.
const v27Idx = src.indexOf("page-count repair failed");
if (v27Idx < 0) { console.error('[R-05] FAIL: v27 catch log not found in source'); process.exit(1); }
// The catch block runs from the log line to its closing brace.
const catchTail = src.slice(v27Idx, src.indexOf('\n        }', v27Idx));
const stopsChain = /\breturn;/.test(catchTail);
check('source: v27 catch stops the chain       ', stopsChain, true);

if (failures) {
  console.error('[R-05] FAIL: a failed v27 is stamped over by v28 and never retried.');
  process.exit(1);
}
console.log('[R-05] PASS: a swallowed v27 failure stops the chain and is retried next launch.');
