// OSS: native-module + LicenseManager pairing tests applied only when the
// private premium submodule was built. This fork removed the license surface
// entirely — there is no activate/deactivate handler and no billing phone-home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('no license activate/deactivate handlers or Dodo/Gumroad phone-home', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.doesNotMatch(src, /safeHandle\('license:activate'/);
  assert.doesNotMatch(src, /safeHandle\('license:deactivate'/);
  assert.doesNotMatch(src, /activateWithApiKey/);
});
