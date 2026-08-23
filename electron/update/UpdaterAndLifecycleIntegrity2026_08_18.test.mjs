// F-707 / F-709 / F-710 regression tests (audit/autopilot-2026-08-18).
//
// Three latent integrity defects — none user-visible today, all of which make
// a documented safety property untrue:
//
//  F-707 electron-updater's `channel` setter ends with allowDowngrade = true
//        (verified below against the installed package), so setting
//        channel='latest' disabled the library-side downgrade filter that
//        quitAndInstall's comment says it is belt-and-bracing. The app's
//        hand-rolled isRealUpgrade then becomes load-bearing, not redundant.
//  F-709 Electron fires will-quit AFTER before-quit. before-quit deliberately
//        preserves a specific quit reason; will-quit recorded 'user-quit'
//        unguarded and therefore always won, discarding
//        'updater-quit-install' and its {fromVersion,toVersion} meta.
//  F-710 the unsigned-macOS fallback captured info.filePath specifically to
//        avoid private APIs, then never read it — depending entirely on two
//        undocumented electron-updater internals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const require_ = createRequire(import.meta.url);
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const lifecycle = fs.readFileSync(path.join(root, 'electron/utils/lifecycleTracker.ts'), 'utf8');

test('F-707: allowDowngrade is restored after the channel setter clobbers it', () => {
  const updater = fs.readFileSync(require_.resolve('electron-updater/out/AppUpdater.js'), 'utf8');
  const clobbers = /set channel\([\s\S]{0,900}?allowDowngrade = true/.test(updater);
  if (!clobbers) {
    // If a future electron-updater stops doing this the guard is harmless.
    return;
  }
  const i = main.indexOf("autoUpdater.channel = 'latest'");
  assert.notEqual(i, -1);
  assert.ok(/autoUpdater\.allowDowngrade\s*=\s*false/.test(main.slice(i, i + 900)),
    'setting channel enables downgrades; restore the default explicitly after it (F-707)');
});

test('F-709: will-quit does not clobber a more specific quit reason', () => {
  const wq = lifecycle.indexOf("app.on('will-quit'");
  assert.notEqual(wq, -1);
  // Bound to the will-quit handler only — before-quit below carries the same
  // guard, so a wide window would pass vacuously.
  const end = lifecycle.indexOf("app.on('window-all-closed'", wq);
  const body = lifecycle.slice(wq, end === -1 ? wq + 400 : end);
  assert.ok(/if \(!this\.marker\.quitReason\)/.test(body),
    'will-quit fires after before-quit, so it must preserve an existing reason (F-709)');
});

test('F-710: the fallback prefers the captured public update path', () => {
  const i = main.indexOf('const updateFile =');
  assert.notEqual(i, -1);
  const body = main.slice(i, i + 400);
  assert.ok(/this\.downloadedUpdateInfo\?\.updateFile/.test(body),
    'the public path captured on update-downloaded must be used before the private APIs (F-710)');
});
