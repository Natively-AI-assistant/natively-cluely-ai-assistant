// OSS: the licensing storefront (pricing phone-home + license IPC) was removed.
// Assert no storefront pricing surface remains and BYOK usage still works.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('no storefront pricing handler or phone-home remains', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.doesNotMatch(src, /safeHandle\('get-natively-pricing'/);
  assert.doesNotMatch(src, /api\.natively\.software\/v1\/pricing/);
});

test('get-natively-usage still exists for BYOK quota', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.match(src, /safeHandle\('get-natively-usage'/);
  assert.match(src, /api\.natively\.software\/v1\/usage/);
});
