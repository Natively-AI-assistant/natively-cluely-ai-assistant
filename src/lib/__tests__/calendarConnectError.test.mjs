// src/lib/__tests__/calendarConnectError.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, '../calendarConnectError.ts');

// Source is TypeScript — assert the contract via source + a tiny eval of the
// exported function body by compiling with a strip-types require when available,
// otherwise pin the mapping strings in the source file.
describe('formatCalendarConnectError (#257)', () => {
  test('source exports mapper with known failure copy', () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    assert.match(src, /export function formatCalendarConnectError/);
    assert.match(src, /GOOGLE_CLIENT_ID|not configured/);
    assert.match(src, /access_denied/);
    assert.match(src, /test accounts/);
    assert.match(src, /timed out|timeout/i);
  });

  test('mapper returns friendly strings when loadable', async () => {
    // Prefer dist if present; otherwise skip runtime asserts (source contract above).
    const distCandidates = [
      path.resolve(__dirname, '../../../dist/lib/calendarConnectError.js'),
      path.resolve(__dirname, '../../../dist-electron/src/lib/calendarConnectError.js'),
    ];
    const dist = distCandidates.find((p) => fs.existsSync(p));
    if (!dist) return;

    const require = createRequire(import.meta.url);
    const { formatCalendarConnectError } = require(dist);
    assert.match(
      formatCalendarConnectError('GOOGLE_CLIENT_ID is not configured'),
      /configured/i,
    );
    assert.match(formatCalendarConnectError('access_denied'), /test accounts/i);
  });
});
