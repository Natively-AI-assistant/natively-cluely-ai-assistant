// L2 (2026-11-09): the permissions card stops coming back at every launch.
//
// While a required permission was missing the card came back ~2 s into every
// launch, its close remembered only in memory. Now a close waits 7 days, the
// third close ends it as a startup card, and granting everything clears the
// record. Both platform branches are driven through the check's `platform`
// (macOS: microphone + Screen Recording; Windows: microphone), never by
// mutating process.platform.
//
// Run: node --test src/lib/__tests__/PermissionsCardPolicy2026_11_09.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERMISSIONS_CARD_SNOOZE_MS,
  PERMISSIONS_CARD_MAX_DISMISSALS,
  emptyPermissionsCardRecord,
  normalizePermissionsCardRecord,
  applyPermissionsCardEvent,
  permissionsCardSnoozed,
  requiredPermissionsGranted,
  startupPermissionsAttention,
} from '../permissionsCardPolicy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const NOW = 1_800_000_000_000;
const D = 86_400_000;

const MAC_NO_SCREEN = { platform: 'darwin', microphone: 'granted', screen: 'denied' };
const MAC_NO_MIC = { platform: 'darwin', microphone: 'denied', screen: 'granted' };
const MAC_ALL = { platform: 'darwin', microphone: 'granted', screen: 'granted' };
const WIN_NO_MIC = { platform: 'win32', microphone: 'denied', screen: 'granted' };
const WIN_ALL = { platform: 'win32', microphone: 'granted', screen: 'granted' };

const dismissed = (times, lastAt) => {
  let r = emptyPermissionsCardRecord();
  for (let i = 0; i < times; i++) r = applyPermissionsCardEvent(r, 'dismissed', lastAt);
  return r;
};

test('the policy numbers: 7 days, three closes', () => {
  assert.equal(PERMISSIONS_CARD_SNOOZE_MS, 7 * D);
  assert.equal(PERMISSIONS_CARD_MAX_DISMISSALS, 3);
});

test('a close counts and stamps the time; granting clears', () => {
  const once = applyPermissionsCardEvent(null, 'dismissed', NOW);
  assert.deepEqual(once, { dismissals: 1, lastDismissedAt: NOW });
  assert.deepEqual(applyPermissionsCardEvent(once, 'dismissed', NOW + D), { dismissals: 2, lastDismissedAt: NOW + D });
  assert.deepEqual(applyPermissionsCardEvent(once, 'granted', NOW), emptyPermissionsCardRecord());
  assert.throws(() => applyPermissionsCardEvent(once, 'bogus', NOW));
});

test('a malformed record reads as never closed', () => {
  for (const raw of [null, undefined, 'x', 7, {}, { dismissals: -2, lastDismissedAt: 'yesterday' }, { dismissals: NaN }]) {
    assert.deepEqual(normalizePermissionsCardRecord(raw), emptyPermissionsCardRecord(), JSON.stringify(raw));
  }
});

test('first launch (never closed): the card is not held back', () => {
  for (const check of [MAC_NO_SCREEN, MAC_NO_MIC, WIN_NO_MIC]) {
    assert.equal(startupPermissionsAttention(check, null, NOW), true, check.platform);
    assert.equal(startupPermissionsAttention(check, emptyPermissionsCardRecord(), NOW), true, check.platform);
  }
});

test('macOS: Screen Recording skipped on purpose: closed, the card waits 7 days, then returns', () => {
  const r = dismissed(1, NOW);
  assert.equal(startupPermissionsAttention(MAC_NO_SCREEN, r, NOW + D), false, 'next launch: no dimmed card');
  assert.equal(startupPermissionsAttention(MAC_NO_SCREEN, r, NOW + 7 * D - 1), false);
  assert.equal(startupPermissionsAttention(MAC_NO_SCREEN, r, NOW + 7 * D), true, 'back after 7 days');
});

test('macOS and Windows: after the third close it is no longer a startup card', () => {
  const r = dismissed(3, NOW);
  for (const check of [MAC_NO_SCREEN, MAC_NO_MIC, WIN_NO_MIC]) {
    assert.equal(startupPermissionsAttention(check, r, NOW + 400 * D), false, check.platform);
  }
});

test('Windows: a missing microphone follows the same 7-day wait', () => {
  const r = dismissed(2, NOW);
  assert.equal(startupPermissionsAttention(WIN_NO_MIC, r, NOW + 6 * D), false);
  assert.equal(startupPermissionsAttention(WIN_NO_MIC, r, NOW + 7 * D), true);
});

test('nothing missing: never a card, record or not', () => {
  assert.equal(startupPermissionsAttention(MAC_ALL, null, NOW), false);
  assert.equal(startupPermissionsAttention(WIN_ALL, null, NOW), false);
});

test('a clock set backwards only delays', () => {
  const r = dismissed(1, NOW + 2 * D);
  assert.equal(permissionsCardSnoozed(r, NOW), true);
  assert.equal(permissionsCardSnoozed(r, NOW + 9 * D), false);
});

test('requiredPermissionsGranted: macOS needs mic + Screen Recording, Windows the mic', () => {
  assert.equal(requiredPermissionsGranted(MAC_ALL), true);
  assert.equal(requiredPermissionsGranted(MAC_NO_SCREEN), false);
  assert.equal(requiredPermissionsGranted(MAC_NO_MIC), false);
  assert.equal(requiredPermissionsGranted({ platform: 'darwin', microphone: 'granted', screen: 'not-determined' }), false);
  assert.equal(requiredPermissionsGranted(WIN_ALL), true);
  assert.equal(requiredPermissionsGranted({ platform: 'win32', microphone: 'granted', screen: 'unknown' }), true, 'Windows has no screen gate');
  assert.equal(requiredPermissionsGranted(WIN_NO_MIC), false);
  assert.equal(requiredPermissionsGranted({ platform: 'win32', microphone: 'not-determined' }), false, 'a failed query is not a grant');
  assert.equal(requiredPermissionsGranted({ platform: 'linux', microphone: 'granted', screen: 'granted' }), false, 'no other platform clears it');
  assert.equal(requiredPermissionsGranted(null), false);
});

// ── Wiring (source-level: App and the host need a DOM and the bridge) ──────
const app = fs.readFileSync(path.resolve(here, '../../App.tsx'), 'utf8');
const host = fs.readFileSync(path.resolve(here, '../../components/onboarding/OrchestratedToasterHost.tsx'), 'utf8');

test('App.tsx: the launch check applies the record, and a full grant clears it', () => {
  const start = app.indexOf('const maybeCheck = window.electronAPI?.checkPermissions;');
  assert.notEqual(start, -1);
  const block = app.slice(start, app.indexOf('// Donation status', start));
  assert.match(block, /permissionsCardGet\?\.\(\)/);
  assert.match(block, /permissionsNeedAttention: startupPermissionsAttention\(p, record, Date\.now\(\)\)/);
  assert.match(block, /if \(requiredPermissionsGranted\(p\) && record && record\.dismissals > 0\) \{\s*window\.electronAPI\?\.permissionsCardRecord\?\.\('granted'\)/);
});

test('the host counts a close in main (not for a DEV-forced card)', () => {
  const i = host.indexOf("case 'permissions':");
  const block = host.slice(i, host.indexOf("case 'plans':", i));
  assert.match(block, /if \(!forced\) window\.electronAPI\?\.permissionsCardRecord\?\.\('dismissed'\)/);
});
