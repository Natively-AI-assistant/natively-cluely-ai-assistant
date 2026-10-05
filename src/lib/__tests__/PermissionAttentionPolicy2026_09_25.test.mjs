// When does the permissions card come back after the first launch?
//
// Rule (agreed 2026-09-25): only when a REQUIRED permission is missing AND the
// user can fix it. macOS needs microphone + Screen Recording; Windows needs the
// microphone only (screen capture has no permission gate there).
//
// The same status string means different things per platform:
//   * macOS 'restricted' = MDM / parental controls. Not user-fixable, so it
//     must NOT re-raise the card every launch.
//   * Windows 'restricted' = the device-wide "Microphone access" switch is off.
//     The most common Windows denial, fixed in the privacy panel, so it MUST.
//
// Screen Recording on macOS is resolved through a capture probe because
// getMediaAccessStatus('screen') misreports a real grant until relaunch. A
// probe that times out keeps the raw status: the meeting path
// (main.ts resolveMacScreenCaptureCapability) treats the same timeout as
// blocked, and the card must agree with what a meeting will actually do.
//
// Windows 'not-determined' is what a FAILED status query leaves behind
// (micPermissionPolicy.mjs), not a user choice, so it must not nag either.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { permissionsNeedAttention, resolveMacScreenStatus } from '../permissionAttentionPolicy.mjs';

const CASES = [
  // [platform, microphone, screen, needsAttention]
  ['darwin', 'granted', 'granted', false],
  ['darwin', 'denied', 'granted', true],
  ['darwin', 'not-determined', 'granted', true],
  ['darwin', 'restricted', 'granted', false],
  ['darwin', 'granted', 'denied', true],
  ['darwin', 'granted', 'not-determined', true],
  ['darwin', 'granted', 'restricted', false],
  ['darwin', 'granted', 'unknown', false],
  ['darwin', 'unknown', 'granted', false],
  ['darwin', 'restricted', 'denied', true],
  ['win32', 'granted', 'granted', false],
  ['win32', 'denied', 'granted', true],
  ['win32', 'restricted', 'granted', true],
  ['win32', 'not-determined', 'granted', false],
  ['win32', 'granted', 'denied', false],
  ['linux', 'denied', 'denied', false],
  ['freebsd', 'denied', 'denied', false],
];

for (const [platform, microphone, screen, want] of CASES) {
  test(`${platform}: mic=${microphone} screen=${screen} → ${want ? 'show card' : 'stay quiet'}`, () => {
    assert.equal(permissionsNeedAttention({ platform, microphone, screen }), want);
  });
}

test('a failed or empty permission check never raises the card', () => {
  assert.equal(permissionsNeedAttention(null), false);
  assert.equal(permissionsNeedAttention(undefined), false);
  assert.equal(permissionsNeedAttention({ platform: 'darwin' }), false);
  assert.equal(permissionsNeedAttention({ platform: 'win32' }), false);
});

// ── macOS Screen Recording probe ─────────────────────────────────────────

const never = () => new Promise(() => {});

test('a granted raw status is trusted without probing', async () => {
  let probed = false;
  const status = await resolveMacScreenStatus('granted', async () => { probed = true; return false; });
  assert.equal(status, 'granted');
  assert.equal(probed, false);
});

test('a restricted raw status is trusted without probing', async () => {
  let probed = false;
  const status = await resolveMacScreenStatus('restricted', async () => { probed = true; return true; });
  assert.equal(status, 'restricted');
  assert.equal(probed, false);
});

test('a misreported grant is corrected when the capture probe succeeds', async () => {
  assert.equal(await resolveMacScreenStatus('denied', async () => true), 'granted');
  assert.equal(await resolveMacScreenStatus('not-determined', async () => true), 'granted');
});

test('the raw status stands when the probe finds no capturable screen', async () => {
  assert.equal(await resolveMacScreenStatus('denied', async () => false), 'denied');
  assert.equal(await resolveMacScreenStatus('not-determined', async () => false), 'not-determined');
});

test('the raw status stands when the probe throws', async () => {
  assert.equal(await resolveMacScreenStatus('denied', async () => { throw new Error('tcc'); }), 'denied');
});

test('a probe that times out keeps the raw status, like the meeting path', async () => {
  assert.equal(await resolveMacScreenStatus('not-determined', never, { timeoutMs: 20 }), 'not-determined');
  assert.equal(await resolveMacScreenStatus('denied', never, { timeoutMs: 20 }), 'denied');
});
