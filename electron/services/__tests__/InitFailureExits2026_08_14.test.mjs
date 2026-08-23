// F-110 regression pin (audit/autopilot-2026-08-14).
//
// A throw in initializeApp's unguarded stretch unwound into the top-level
// .catch, which logged, closed the DB, wrote a report — and returned without
// exiting. The process survived as a windowless zombie holding the
// single-instance lock (on macOS still 'accessory', so no dock tile);
// every relaunch signaled the zombie and showed nothing. The repo itself
// named this hazard at assertVerificationFlagsOrThrow. Live-reproduced via
// the NATIVELY_TEST_INIT_FAULT hook in scripts/audit/F-110-repro.mjs
// (process alive 15s post-failure pre-fix; exit code 1 post-fix).
//
// Contracts pinned here: the catch ends in app.exit(1), and the
// deterministic fault hook stays in the unguarded stretch so the repro
// remains runnable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

test('initializeApp catch terminates the half-initialized process', () => {
  const anchor = source.indexOf('initializeApp().catch');
  assert.notEqual(anchor, -1, 'initializeApp().catch not found');
  const block = source.slice(anchor, anchor + 2200);
  // The catch used to call app.exit(1) inline. It now routes through
  // terminateAfterFatalError('initializeApp-failed', 1) — the same terminal
  // coordinator the DB-survival pin names as the ONLY sanctioned way to close
  // the database from a handler that would otherwise keep running. The
  // invariant is that the half-initialized process actually dies, not which
  // function spells the exit, so accept either and verify the coordinator
  // really exits rather than trusting its name.
  const directExit = /app\.exit\(1\)/.test(block);
  const viaCoordinator = /terminateAfterFatalError\(\s*['"][^'"]*['"]\s*,\s*1\s*\)/.test(block);
  assert.ok(
    directExit || viaCoordinator,
    'initializeApp().catch must terminate the process (app.exit(1) or terminateAfterFatalError(..., 1)) — ' +
    'otherwise a mid-init throw leaves a windowless zombie holding the single-instance lock (F-110)'
  );
  if (!directExit) {
    const fnIdx = source.search(/function terminateAfterFatalError/);
    assert.ok(fnIdx >= 0, 'terminateAfterFatalError must exist if the catch delegates to it');
    const fnBody = source.slice(fnIdx, fnIdx + 900);
    assert.match(
      fnBody, /\.exit\(code\)/,
      'terminateAfterFatalError must actually exit the process — delegating to a coordinator that ' +
      'never exits reintroduces exactly the windowless zombie F-110 describes.'
    );
  }
});

test('init fault-injection hook remains available for the repro', () => {
  assert.ok(
    source.includes("process.env.NATIVELY_TEST_INIT_FAULT === '1'"),
    'NATIVELY_TEST_INIT_FAULT hook missing — scripts/audit/F-110-repro.mjs would be untestable'
  );
});
