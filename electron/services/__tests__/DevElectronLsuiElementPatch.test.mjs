/**
 * Regression: missing LSUIElement on the dev Electron.app Info.plist makes macOS
 * paint a spawn-time "Electron" dock tile before JS can rename/promote the app —
 * the classic multi-dock-icon symptom on `npm start`.
 *
 * postinstall runs scripts/patch-electron-plist.js; this test asserts the patch
 * landed (or is applied idempotently when run here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const plistPath = path.join(
  repoRoot,
  'node_modules/electron/dist/Electron.app/Contents/Info.plist',
);
const patchScript = path.join(repoRoot, 'scripts/patch-electron-plist.js');

test('dev Electron.app Info.plist has LSUIElement=1 after patch', () => {
  assert.ok(fs.existsSync(plistPath), 'Electron.app Info.plist must exist on macOS');
  assert.ok(fs.existsSync(patchScript), 'patch-electron-plist.js must exist');

  const result = spawnSync(process.execPath, [patchScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `patch script failed: ${result.stderr || result.stdout}`);

  const content = fs.readFileSync(plistPath, 'utf8');
  assert.match(
    content,
    /<key>LSUIElement<\/key>\s*<string>1<\/string>/,
    'BUG: LSUIElement=1 missing — expect multiple Dock tiles on npm start (Electron + Natively)',
  );
});
