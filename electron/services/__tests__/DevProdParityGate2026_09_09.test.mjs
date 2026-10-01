// Four independent dev-vs-packaged parity gaps, all the same shape as the
// ProcessingHelper fix in ProcessingHelperEnvKeyGate2026_09_09.test.mjs: a
// NODE_ENV-only (or app.isPackaged-only, one-sided) check that a sibling in
// this codebase already hardened with the paired condition, but that never
// got propagated to these files. Each was reproduced live in a real packaged
// (ad-hoc signed, app.isPackaged === true) Natively.app before being fixed:
//
//   - Settings/Cropper/ModelSelector windows: with NODE_ENV=development
//     leaked into the packaged launch's environment, all three windows still
//     loaded file://.../dist/index.html (not http://127.0.0.1:5180), matching
//     WindowHelper.ts's already-hardened isDev predicate.
//   - checkForUpdates(): with the same leaked NODE_ENV=development, the log
//     showed "[AutoUpdater] Checking for update..." (the real
//     autoUpdater.checkForUpdatesAndNotify() event), not the manual
//     GitHub-API-only checkForUpdatesManual() path.
//   - test-inject-transcript / test-get-mode-context: with NODE_ENV=test
//     leaked into the packaged launch, both now return
//     {success:false,error:'test_only'} instead of executing, while an
//     unpackaged dev+test launch still uses them normally (regression check).
//
// ScreenshotHelper's TCC-bypass fix could not be behaviorally re-verified in
// this pass without revoking the real Screen Recording grant already held by
// the developer's local Electron binary (out of scope to touch); it is
// covered here by static assertion only, mirroring main.ts's already-proven
// isDevTccBypassEnabled() pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

test('Settings/Cropper/ModelSelector windows gate on app.isPackaged, not NODE_ENV alone', () => {
  for (const file of [
    'electron/SettingsWindowHelper.ts',
    'electron/CropperWindowHelper.ts',
    'electron/ModelSelectorWindowHelper.ts',
  ]) {
    const src = read(file);
    assert.match(
      src,
      /const isDev = process\.env\.NODE_ENV === "development" && !app\.isPackaged/,
      `${file} must require !app.isPackaged in addition to NODE_ENV`,
    );
  }
});

test('checkForUpdates() branches on app.isPackaged, not NODE_ENV', () => {
  const src = read('electron/main.ts');
  const fn = src.slice(
    src.indexOf('public async checkForUpdates('),
    src.indexOf('checkForUpdates failed'),
  );
  assert.match(fn, /if \(!app\.isPackaged\)/,
    'checkForUpdates must gate on !app.isPackaged');
  assert.doesNotMatch(fn, /process\.env\.NODE_ENV/,
    'checkForUpdates must not read NODE_ENV directly any more');
});

test('test-inject-transcript and test-get-mode-context require app.isPackaged to be false', () => {
  const src = read('electron/ipcHandlers.ts');
  for (const handlerName of ['test-inject-transcript', 'test-get-mode-context']) {
    const start = src.indexOf(`'${handlerName}'`);
    assert.ok(start >= 0, `${handlerName} handler not found`);
    const body = src.slice(start, start + 600);
    assert.match(body, /process\.env\.NODE_ENV !== 'test' \|\| app\.isPackaged/,
      `${handlerName} must require both NODE_ENV==='test' and !app.isPackaged`);
  }
});

test('ScreenshotHelper TCC bypass requires both !app.isPackaged and the explicit opt-in env var', () => {
  const src = read('electron/ScreenshotHelper.ts');
  const fn = src.slice(
    src.indexOf('function assertScreenRecordingPermission'),
    src.indexOf('getMediaAccessStatus'),
  );
  assert.match(
    fn,
    /if \(!app\.isPackaged && process\.env\.NATIVELY_DEV_BYPASS_SCREEN_TCC === '1'\) return;/,
    'the dev bypass must require the explicit NATIVELY_DEV_BYPASS_SCREEN_TCC=1 opt-in, matching main.ts\'s isDevTccBypassEnabled()',
  );
});
