// L6 (2026-11-09): the long-term memory notice sees a boot-time failure, and
// its ✕ holds.
//
// - The launcher's notice mounts ~3 s after the splash and only subscribed, so
//   a spawn failure broadcast at boot never reached it. It now reads the last
//   status from main (hindsight:get-status) on mount.
// - Every broadcast cleared the ✕, so a server that kept retrying brought the
//   notice straight back. A close now holds until a different failure, or a
//   recovery and then a failure.
//
// Run: node --test src/lib/__tests__/HindsightBannerPolicy2026_11_09.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initialHindsightBanner, applyHindsightStatus, dismissHindsightBanner, hindsightBannerDismissed, hindsightStatusKey,
} from '../hindsightBannerPolicy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const failed = (reason = 'server exited with code 1') => ({ state: 'spawn-failed', reason, at: Date.now() });
const run = (...events) => events.reduce((s, e) => (e === 'X' ? dismissHindsightBanner(s) : applyHindsightStatus(s, e)), initialHindsightBanner());
const shown = (s) => !!s.status && !hindsightBannerDismissed(s);

test('a failure shows; a recovery hides it', () => {
  assert.equal(shown(run(failed())), true);
  assert.equal(shown(run(failed(), { state: 'ready' })), false);
});

test('the same failure broadcast again does not undo the ✕', () => {
  assert.equal(shown(run(failed(), 'X', failed(), failed())), false);
});

test('a retry (spawning) does not undo the ✕, nor does the same failure after it', () => {
  assert.equal(shown(run(failed(), 'X', { state: 'spawning' })), false);
  assert.equal(shown(run(failed(), 'X', { state: 'spawning' }, failed())), false);
});

test('a genuinely different failure shows again', () => {
  assert.equal(shown(run(failed('a'), 'X', failed('b'))), true, 'another reason');
  assert.equal(shown(run(failed(), 'X', { state: 'unreachable', reason: 'no answer' })), true, 'another state');
  assert.equal(shown(run({ state: 'spawning' }, 'X', failed())), true, 'closed while starting, then it failed');
});

test('a recovery, then the same failure, shows again', () => {
  assert.equal(shown(run(failed(), 'X', { state: 'ready' }, failed())), true);
});

test('malformed statuses are ignored', () => {
  const s = run(failed());
  assert.equal(applyHindsightStatus(s, null), s);
  assert.equal(applyHindsightStatus(s, { reason: 'no state' }), s);
  assert.equal(hindsightStatusKey(null), null);
});

// ── Wiring ────────────────────────────────────────────────────────────────
const banner = fs.readFileSync(path.resolve(here, '../../components/HindsightStatusBanner.tsx'), 'utf8');
const ipc = fs.readFileSync(path.resolve(here, '../../../electron/ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.resolve(here, '../../../electron/preload.ts'), 'utf8');
const manager = fs.readFileSync(path.resolve(here, '../../../electron/services/HindsightManager.ts'), 'utf8');

test('the banner reads the current status on mount, and a broadcast heard first wins', () => {
  assert.match(banner, /window\.electronAPI\?\.getHindsightStatus\?\.\(\)/);
  assert.match(banner, /if \(live && !heard && current\) setBanner/);
  assert.doesNotMatch(banner, /setDismissed\(false\)/, 'no broadcast clears the ✕ any more');
});

test('main keeps the last status and answers hindsight:get-status', () => {
  assert.match(manager, /this\.lastStatus = payload;\s*try \{/, 'kept before the send, even headless');
  assert.match(ipc, /safeHandle\('hindsight:get-status'[\s\S]*?getLastStatus\(\)/);
  assert.match(preload, /getHindsightStatus: \(\) => ipcRenderer\.invoke\('hindsight:get-status'\)/);
  // The two statuses ipcHandlers broadcasts itself are kept too, or a reload
  // would read a stale failure after "disabled by user".
  assert.equal((ipc.match(/\.noteStatus\(status\)/g) ?? []).length, 2);
});
