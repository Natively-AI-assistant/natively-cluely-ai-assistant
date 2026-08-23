// F-104 regression pin (audit/autopilot-2026-08-14).
//
// The system-audio recovery and route-change rebuild flows fired
// oldCapture?.destroy() WITHOUT awaiting it. destroy() → stop() defers the
// blocking native monitor.stop() via setImmediate, while the intervening
// resolveMacScreenCaptureCapability await resolves in microtasks on the
// warm-cache / dev-bypass paths — so the fresh capture's start() acquired the
// CoreAudio tap while the dying monitor still held the HAL property-listener
// lock ("0 chunks in 8s" / main-thread deadlock, both documented in-repo).
// Live-reproduced as a deterministic ordering violation in
// scripts/audit/F-104-repro.mjs. Every other teardown site already awaited.
//
// Contract pinned here: within both flows, the old capture's destroy is
// awaited (never a bare fire-and-forget call).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

test('rebuild flows await the old capture teardown before constructing fresh', () => {
  const awaited = source.match(/await oldCapture\?\.destroy\(\)/g) ?? [];
  assert.ok(
    awaited.length >= 2,
    `expected the recovery AND route-change flows to await oldCapture?.destroy(); found ${awaited.length}`
  );
  assert.ok(
    !/(?<!await )oldCapture\?\.destroy\(\)/.test(source),
    'found a fire-and-forget oldCapture?.destroy() — the fresh capture would race the dying monitor for the HAL lock (F-104)'
  );
});
