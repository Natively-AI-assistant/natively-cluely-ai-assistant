// F-109 regression pin (audit/autopilot-2026-08-14).
//
// child-process-gone fires for RECOVERABLE Chromium child exits — a SIGKILLed
// GPU process is relaunched by Chromium within seconds and the app keeps
// running (live-verified via scripts/audit/F-109-repro.mjs). The handler used
// to call emergencyCloseDatabase() unconditionally, which is irreversible
// (DatabaseManager.closeWithoutCheckpoint() nulls the singleton and
// openWithWalSelfHeal() only runs from the constructor), so every driver
// hiccup / utility-process restart silently killed meeting saves, transcript
// persistence and mode lookups for the rest of the session.
//
// Contract pinned here: in BOTH the child-process-gone and gpu-process-crashed
// handlers, emergencyCloseDatabase may only run behind an isQuitting() gate —
// matching render-process-gone's documented "only close the DB on TERMINAL
// paths" policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

function handlerBlock(eventName) {
  const anchor = source.indexOf(`app.on('${eventName}'`);
  assert.notEqual(anchor, -1, `no app.on('${eventName}') registration found`);
  // The registrations under audit are short; a bounded slice keeps the
  // ordering assertions below resilient to reformatting.
  return source.slice(anchor, anchor + 1200);
}

for (const eventName of ['child-process-gone', 'gpu-process-crashed']) {
  test(`${eventName} handler closes the DB only behind an isQuitting() gate`, () => {
    const block = handlerBlock(eventName);
    // Match the actual call (quoted reason argument), not prose in comments.
    const close = block.indexOf(`emergencyCloseDatabase('${eventName}')`);
    assert.notEqual(close, -1, `${eventName}: emergencyCloseDatabase call not found in handler block`);
    const gate = block.indexOf('isQuitting');
    assert.notEqual(
      gate,
      -1,
      `${eventName}: no isQuitting() gate — an unconditional emergencyCloseDatabase turns recoverable child restarts into permanent silent persistence loss (F-109)`
    );
    assert.ok(
      gate < close,
      `${eventName}: the isQuitting() gate must precede emergencyCloseDatabase`
    );
  });
}
