// Windows capture mode (utils/windowsCaptureMode): which invisibility the OS
// can actually deliver — full exclusion vs black box — gated on the OS build.
// Pure contract tests. Imports COMPILED output from dist-electron
// (npm run build:electron first), like the other utils suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/utils', p);
const { resolveWindowsCaptureMode, WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD } = require(
  dist('windowsCaptureMode.js'),
);

test('threshold constant matches the documented Windows 10 2004 build', () => {
  assert.equal(WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD, 19041);
});

test('darwin is always excluded (no build split on macOS)', () => {
  assert.equal(resolveWindowsCaptureMode('darwin'), 'excluded');
  assert.equal(resolveWindowsCaptureMode('darwin', '24.0.0'), 'excluded');
});

test('modern Windows builds exclude', () => {
  assert.equal(resolveWindowsCaptureMode('win32', '10.0.19041'), 'excluded');
  assert.equal(resolveWindowsCaptureMode('win32', '10.0.22631'), 'excluded');
  assert.equal(resolveWindowsCaptureMode('win32', '10.0.26100'), 'excluded');
});

test('pre-2004 Windows builds black out (accepted call, black-box behaviour)', () => {
  assert.equal(resolveWindowsCaptureMode('win32', '10.0.18363'), 'blacked_out');
  assert.equal(resolveWindowsCaptureMode('win32', '10.0.10240'), 'blacked_out');
});

test('unparseable versions are unknown, never silently assumed', () => {
  assert.equal(resolveWindowsCaptureMode('win32', undefined), 'unknown');
  assert.equal(resolveWindowsCaptureMode('win32', ''), 'unknown');
  assert.equal(resolveWindowsCaptureMode('win32', 'garbage'), 'unknown');
  assert.equal(resolveWindowsCaptureMode('win32', '10.0'), 'unknown');
});

test('other platforms are unsupported', () => {
  assert.equal(resolveWindowsCaptureMode('linux'), 'unsupported');
});
