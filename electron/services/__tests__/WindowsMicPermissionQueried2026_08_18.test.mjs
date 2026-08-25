// F-706 regression test (audit/autopilot-2026-08-18).
//
// permissions:check returned a hardcoded { microphone: 'granted' } for every
// non-darwin platform, with a comment claiming Windows has no queryable
// permission state. Electron's own typings say otherwise:
//   getMediaAccessStatus(mediaType: 'microphone' | 'camera' | 'screen')
//   "Windows 10 has a global setting controlling microphone and camera
//    access ... @platform win32,darwin"
// So with the Windows per-app or global microphone toggle off, onboarding
// never prompted, the launcher's check stayed green, and capture silently
// yielded nothing with no diagnosable cause. The macOS branch directly above
// does a full status query plus a capture probe — this was a missing platform
// branch, not a platform limitation.
//
// Cannot be executed on macOS, so this pins the SOURCE contract; physical
// verification on Windows is still required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

function permissionsCheckBody() {
  const i = src.indexOf("safeHandle('permissions:check'");
  assert.notEqual(i, -1, 'permissions:check handler not found');
  const j = src.indexOf("safeHandle('permissions:request-mic'", i);
  return src.slice(i, j === -1 ? i + 4000 : j);
}

test('Windows queries the real microphone status instead of hardcoding granted', () => {
  const body = permissionsCheckBody();
  const i = body.indexOf("process.platform === 'win32'");
  assert.notEqual(i, -1, 'permissions:check must have an explicit win32 branch (F-706)');
  const win = body.slice(i, i + 900);
  assert.ok(/getMediaAccessStatus\('microphone'\)/.test(win),
    "the win32 branch must query getMediaAccessStatus('microphone') (F-706)");
  assert.ok(!/return \{ microphone: 'granted', screen: 'granted', platform: 'win32' \}/.test(win),
    'the win32 branch must not return a hardcoded granted microphone');
});

test('a failed query falls back to granted so it cannot lock out a working machine', () => {
  const body = permissionsCheckBody();
  const i = body.indexOf("process.platform === 'win32'");
  const win = body.slice(i, i + 900);
  assert.ok(/catch\s*\{[\s\S]{0,120}microphone = 'granted'/.test(win),
    'an API failure must fall back to granted, never to denied (F-706)');
});
