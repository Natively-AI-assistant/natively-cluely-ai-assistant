// OSS: LicenseManager lived in the private premium submodule. These tests used
// to exercise HWID-absent read paths against that module. On this fork the
// entire license IPC family is removed (features are unlocked with no gate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const premiumLm = path.join(
  root,
  'dist-electron/premium/electron/services/LicenseManager.js',
);

test('premium LicenseManager is not shipped in this build', () => {
  assert.equal(fs.existsSync(premiumLm), false);
});

test('ipcHandlers has no license IPC family and no premium LicenseManager require', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.doesNotMatch(src, /safeHandle\('license:/);
  assert.doesNotMatch(src, /require\(['"]\.\.\/premium\/electron\/services\/LicenseManager['"]\)/);
});
