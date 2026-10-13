// Linux screenshots capture the shared desktop's nested display while it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { resolveLinuxCaptureDisplay, buildDisplayScreenshotCommand } = require(
  path.resolve(__dirname, '../../../dist-electron/electron/platform/linuxScreenshot.js'),
);

const deps = (over = {}) => ({ env: {}, readMarker: () => null, displayIsUp: () => true, ...over });

test('no override and no marker: capture own display', () => {
  assert.equal(resolveLinuxCaptureDisplay(deps()), null);
});

test('shared-desktop marker is used while its display is up', () => {
  assert.equal(resolveLinuxCaptureDisplay(deps({ readMarker: () => ':1\n' })), ':1');
});

test('stale marker (display gone) falls back to own display', () => {
  assert.equal(resolveLinuxCaptureDisplay(deps({ readMarker: () => ':1', displayIsUp: () => false })), null);
});

test('malformed marker is ignored, never put into a shell command', () => {
  assert.equal(resolveLinuxCaptureDisplay(deps({ readMarker: () => ':1; rm -rf ~' })), null);
});

test('NATIVELY_CAPTURE_DISPLAY wins over the marker; invalid value throws', () => {
  assert.equal(resolveLinuxCaptureDisplay(deps({ env: { NATIVELY_CAPTURE_DISPLAY: ':7' }, readMarker: () => ':1' })), ':7');
  assert.throws(() => resolveLinuxCaptureDisplay(deps({ env: { NATIVELY_CAPTURE_DISPLAY: 'host:0' } })), /must look like ":1"/);
});

test('display command targets that display and skips gnome-screenshot', () => {
  const full = buildDisplayScreenshotCommand(':1', '/u/s.png', false);
  assert.match(full, /^import -display :1 -window root "\/u\/s\.png"/);
  assert.doesNotMatch(full, /gnome-screenshot/);
  assert.match(buildDisplayScreenshotCommand(':1', '/u/s.png', true), /^DISPLAY=:1 scrot -s /);
  assert.throws(() => buildDisplayScreenshotCommand(':1 && x', '/u/s.png', false), /Invalid X display/);
});
