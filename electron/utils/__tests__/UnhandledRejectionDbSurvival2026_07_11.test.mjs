// electron/utils/__tests__/UnhandledRejectionDbSurvival2026_07_11.test.mjs
//
// Regression test for silent, permanent, session-wide database loss on a
// single stray unhandled promise rejection.
//
// THE BUG THIS PINS: electron/main.ts's `process.on('unhandledRejection', ...)`
// handler used to call `emergencyCloseDatabase()` UNCONDITIONALLY on every
// unhandled rejection. `emergencyCloseDatabase()` is irreversible — it nulls
// the DatabaseManager singleton's connection with no reopen path (by design,
// per its own docstring, for genuinely terminal crash paths like SIGTERM or a
// crash-loop give-up). But Node does NOT terminate the process after
// 'unhandledRejection' when a listener is registered, and this handler never
// calls process.exit() — so the app kept running for the REST OF THE SESSION
// with a permanently dead database after the FIRST stray unhandled rejection
// ANYWHERE in a ~750-test, actively-developed codebase (a missing .catch() on
// any fire-and-forget promise). Every meeting save / transcript persist /
// credential lookup would silently no-op from that point on, with zero
// user-facing signal (DatabaseManager.isAvailable() is never surfaced to the
// renderer).
//
// THE FIX mirrors the ALREADY-EXISTING render-process-gone crash-loop-guard
// pattern in the same file (RENDERER_RELOAD_MAX / RENDERER_RELOAD_WINDOW_MS):
// an isolated unhandled rejection is logged but does NOT close the DB. Only
// rapid-fire rejections within a short rolling window (a genuine systemic-
// failure signal) escalate to the terminal, DB-closing path.
//
// main.ts is not a unit-testable module in isolation (it wires the whole
// Electron app at import time), so — matching this codebase's own convention
// for main.ts-level lifecycle logic (see LocalWhisperStuckWorker.test.mjs's
// "source-level structural checks" section) — this is a structural test on
// the compiled source pinning the specific invariants a regression could
// silently break.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../main.ts');
const source = fs.readFileSync(sourcePath, 'utf-8');

describe('unhandledRejection no longer unconditionally kills the database', () => {
  test('a bounded escalation window exists (mirrors the render-process-gone crash-loop guard)', () => {
    assert.match(
      source,
      /const UNHANDLED_REJECTION_MAX\s*=\s*\d+/,
      'UNHANDLED_REJECTION_MAX threshold must be defined',
    );
    assert.match(
      source,
      /const UNHANDLED_REJECTION_WINDOW_MS\s*=\s*\d+/,
      'UNHANDLED_REJECTION_WINDOW_MS rolling-window must be defined',
    );
    const maxMatch = source.match(/UNHANDLED_REJECTION_MAX\s*=\s*(\d+)/);
    assert.ok(maxMatch, 'UNHANDLED_REJECTION_MAX must be a numeric literal');
    const max = parseInt(maxMatch[1], 10);
    // Must be > 1 — a threshold of 1 would be identical to the old
    // unconditional-close bug (every single rejection closes the DB).
    assert.ok(max > 1, `UNHANDLED_REJECTION_MAX=${max} must allow more than one isolated rejection before escalating`);
  });

  test('the unhandledRejection handler body does not call emergencyCloseDatabase unconditionally', () => {
    const handlerStart = source.indexOf("process.on('unhandledRejection'");
    assert.ok(handlerStart >= 0, "process.on('unhandledRejection', ...) must exist");
    // Extract the handler body via balanced-paren walk from the opening `(reason, promise) => {`.
    const bodyOpen = source.indexOf('{', source.indexOf('=>', handlerStart));
    assert.ok(bodyOpen >= 0, 'handler arrow-function body must be locatable');
    let i = bodyOpen + 1;
    let depth = 1;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const body = source.slice(start, i - 1);

    // emergencyCloseDatabase MUST appear only inside a conditional (the
    // escalation branch), never as a bare top-level statement.
    assert.match(
      body,
      /if\s*\([^)]*unhandledRejectionHistory[^)]*>=\s*UNHANDLED_REJECTION_MAX[^)]*\)\s*\{[\s\S]*emergencyCloseDatabase/,
      'emergencyCloseDatabase must only be called inside the escalation-threshold branch',
    );
    // Regression guard: the bug shape was an unconditional call right after
    // the logToFile line, with no guarding `if`. Assert that shape is gone —
    // there must be tracking/counting logic between the log line and any
    // emergencyCloseDatabase call.
    const logIdx = body.indexOf('[CRITICAL] Unhandled Rejection');
    const closeIdx = body.indexOf('emergencyCloseDatabase');
    assert.ok(logIdx >= 0 && closeIdx > logIdx, 'log line must precede the (now-conditional) close call');
    const between = body.slice(logIdx, closeIdx);
    assert.match(
      between,
      /unhandledRejectionHistory/,
      'escalation bookkeeping must sit between logging and any DB close — a direct log→close with nothing between it is the regressed shape',
    );
  });

  test('the rolling window is pruned (old timestamps do not permanently count toward the threshold)', () => {
    assert.match(
      source,
      /unhandledRejectionHistory\.length > 0 && now - unhandledRejectionHistory\[0\] >= UNHANDLED_REJECTION_WINDOW_MS/,
      'stale rejection timestamps outside the window must be pruned before counting',
    );
  });

  test('sibling terminal crash paths (SIGTERM/SIGINT/render-process-gone-loop-giveup) are unaffected — still call emergencyCloseDatabase directly', () => {
    // This fix must be scoped to unhandledRejection specifically. Sanity-check
    // the other genuinely-terminal paths still close the DB unconditionally
    // (they either exit the process or are already gated to a give-up branch).
    assert.match(source, /for \(const sig of \['SIGTERM', 'SIGINT'\]/);
    assert.match(source, /emergencyCloseDatabase\('render-process-gone-loop-giveup'\)/);
  });
});
