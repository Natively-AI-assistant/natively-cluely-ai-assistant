// F-103 regression pin (audit/autopilot-2026-08-14).
//
// The default-output watcher used to advance _lastObservedDefaultOutputId
// BEFORE calling handleDefaultOutputChanged(). The handler's recovery-mutex
// bail (the only bail reachable from a passing tick — the other three
// re-check conditions the tick just checked synchronously) then did no work,
// and the next tick's equality check swallowed the route change for the rest
// of the meeting: CoreAudio Tap stayed bound to the abandoned device, the
// interviewer transcript went silent, and no banner fired. Live-reproduced in
// scripts/audit/F-103-repro.mjs.
//
// Contract pinned here: the watcher's interval must NOT write
// _lastObservedDefaultOutputId after its change-detection check (it may only
// initialize it outside the interval); the commit happens inside
// handleDefaultOutputChanged, AFTER the _systemAudioRecoveryInProgress gate,
// and the handler receives the observed id as an argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

function slice(startMarker, endMarker) {
  const a = source.indexOf(startMarker);
  assert.notEqual(a, -1, `marker not found: ${startMarker}`);
  const b = source.indexOf(endMarker, a);
  assert.notEqual(b, -1, `marker not found after ${startMarker}: ${endMarker}`);
  return source.slice(a, b);
}

test('watcher tick does not commit the observation before the handler runs', () => {
  // From the equality check to the end of the interval callback body.
  const tick = slice(
    'if (currentId === this._lastObservedDefaultOutputId) return;',
    'private stopDefaultOutputWatcher'
  );
  assert.ok(
    !/this\._lastObservedDefaultOutputId\s*=(?!=)/.test(tick),
    'the interval body must not assign _lastObservedDefaultOutputId after change detection — that swallows the change when the handler bails (F-103)'
  );
  assert.ok(
    /handleDefaultOutputChanged\(currentId\)/.test(tick),
    'the handler must receive the observed id so it can commit it itself'
  );
});

test('handler commits the observation only after the recovery-mutex gate', () => {
  const handler = slice(
    'private async handleDefaultOutputChanged(',
    '// Mic-side equivalent of setupAudioRecoveryHandler'
  );
  const gate = handler.indexOf('_systemAudioRecoveryInProgress');
  const commitMatch = /this\._lastObservedDefaultOutputId\s*=(?!=)/.exec(handler);
  assert.notEqual(gate, -1, 'recovery-mutex gate missing from handler');
  assert.ok(commitMatch, 'handler must commit _lastObservedDefaultOutputId');
  assert.ok(
    commitMatch.index > gate,
    'the observation commit must come AFTER the recovery-mutex bail so a deferred cycle retries on the next tick'
  );
});
