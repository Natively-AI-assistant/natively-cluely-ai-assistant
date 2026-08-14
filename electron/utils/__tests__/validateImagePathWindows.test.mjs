// electron/utils/__tests__/validateImagePathWindows.test.mjs
//
// Regression tests for issue #304 — generate-what-to-say rejects Windows
// screenshot paths.
//
// On Windows, app.getPath('userData') resolves to a drive path like
//   C:\Users\Sai\AppData\Roaming\natively
// and ScreenshotHelper writes screenshots to <userData>\screenshots\.
//
// validateImagePath() had an UNCONDITIONAL early-return that rejected every
// path matching /^[A-Za-z]:\\/ ("Windows absolute paths are not allowed").
// Because the app's own userData is always such a path on Windows, the
// allowlist below it was never reached and every legitimate screenshot was
// rejected at the IPC layer — completely breaking screen capture on Windows.
//
// This mirrors the earlier macOS ordering fix (obs 2631): the Windows-drive
// block must run AFTER the userData allowlist, not before it. Arbitrary
// Windows system paths (C:\Windows\System32\...) must still be blocked.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/utils/curlUtils.js',
);
const { validateImagePath } = await import(pathToFileURL(modPath).href);

// Exactly the shape Windows produces (roaming "All Users" install, user "Sai").
const WIN_USER_DATA = 'C:\\Users\\Sai\\AppData\\Roaming\\natively';

describe('validateImagePath — Windows userData ordering (issue #304)', () => {
  test('allows screenshot path inside Windows userData', () => {
    const p = `${WIN_USER_DATA}\\screenshots\\selective-870527a9-78ec-4050-81db-b8df20c68b7c.png`;
    const r = validateImagePath(p, WIN_USER_DATA);
    assert.equal(r.isValid, true, `should allow ${p}, got: ${r.reason}`);
  });

  test('allows extra_screenshots path inside Windows userData', () => {
    const p = `${WIN_USER_DATA}\\extra_screenshots\\abc-123.png`;
    const r = validateImagePath(p, WIN_USER_DATA);
    assert.equal(r.isValid, true, `should allow ${p}, got: ${r.reason}`);
  });

  test('allows screenshot path with forward-slash userData (normalized) too', () => {
    const ud = 'C:/Users/Sai/AppData/Roaming/natively';
    const p = `${ud}/screenshots/abc-123.png`;
    const r = validateImagePath(p, ud);
    assert.equal(r.isValid, true, `should allow ${p}, got: ${r.reason}`);
  });

  test('blocks arbitrary Windows system path outside userData', () => {
    const r = validateImagePath('C:\\Windows\\System32\\config\\SAM', WIN_USER_DATA);
    assert.equal(r.isValid, false, 'system files must remain blocked');
  });

  test('blocks a different drive entirely', () => {
    const r = validateImagePath('D:\\secrets\\private.png', WIN_USER_DATA);
    assert.equal(r.isValid, false, 'paths outside userData must remain blocked');
  });

  test('blocks another user profile on the same drive', () => {
    const r = validateImagePath(
      'C:\\Users\\Administrator\\AppData\\Roaming\\natively\\screenshots\\x.png',
      WIN_USER_DATA,
    );
    assert.equal(r.isValid, false, 'a different user’s userData must remain blocked');
  });

  test('blocks path traversal escape from Windows screenshots dir', () => {
    const p = `${WIN_USER_DATA}\\screenshots\\..\\..\\..\\Windows\\System32\\config\\SAM`;
    const r = validateImagePath(p, WIN_USER_DATA);
    assert.equal(r.isValid, false, 'traversal escape must be blocked even under userData prefix');
  });
});
