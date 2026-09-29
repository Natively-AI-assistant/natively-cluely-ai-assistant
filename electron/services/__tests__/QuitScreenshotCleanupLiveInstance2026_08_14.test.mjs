// F-111 regression pin (audit/autopilot-2026-08-14).
//
// The before-quit screenshot cleanup used to construct a BRAND-NEW
// ScreenshotHelper and call clearQueues() on it. clearQueues() deletes only
// files listed in the instance's in-memory queues — empty on a fresh
// instance — so nothing was ever deleted while the log claimed success, and
// captured meeting screenshots accumulated in userData/screenshots forever.
// Live-reproduced in scripts/audit/F-111-repro.mjs (queued marker survived a
// clean quit pre-fix; deleted post-fix).
//
// Contract pinned here: the before-quit handler clears the LIVE AppState
// helper and never constructs a throwaway ScreenshotHelper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

test('before-quit clears the live screenshot helper, not a fresh instance', () => {
  const anchor = source.indexOf('app.on("before-quit"');
  assert.notEqual(anchor, -1, 'before-quit handler not found');
  const handler = source.slice(anchor, source.indexOf('app.commandLine', anchor));
  assert.ok(
    /appState\.getScreenshotHelper\(\)\?\.clearQueues\(\)/.test(handler),
    'before-quit must clear the LIVE AppState screenshot helper (F-111)'
  );
  // Match the construction as code (assignment form) — not prose mentions in
  // comments explaining why the throwaway instance was wrong.
  assert.ok(
    !/=\s*new ScreenshotHelper\(\)/.test(handler),
    'before-quit must not construct a throwaway ScreenshotHelper — its queues are empty and clearQueues() deletes nothing (F-111)'
  );
});
