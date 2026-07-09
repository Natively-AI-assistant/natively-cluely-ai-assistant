// Entitlement-shape guard for the issue #322 forward-stability fix.
//
// The macOS keychain item "Natively Safe Storage" (Electron safeStorage / Chromium OSCrypt)
// is ACL-bound to the binary's code signature unless a stable keychain-access-groups
// entitlement scopes it to a team group. Dropping that entitlement — or a Team-ID / appId
// typo — silently reintroduces #322 on the NEXT re-sign, and nothing else in CI would catch
// it (the .app isn't signed in unit CI). This pure-text test pins the entitlement shape so a
// regression fails fast in code review, with no signing required.
//
// Run via: node --test electron/services/__tests__/KeychainEntitlement.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const TOP = path.join(repoRoot, 'build/entitlements.mac.plist');
const INHERIT = path.join(repoRoot, 'build/entitlements.mac.inherit.plist');

// Must match electron-builder.signed.cjs (Team ID) + package.json build.appId.
const EXPECTED_GROUP = 'BJM29W3UQ6.com.electron.meeting-notes';

test('top-level entitlements declare the exact keychain-access-group', () => {
  const xml = fs.readFileSync(TOP, 'utf8');
  assert.ok(xml.includes('<key>keychain-access-groups</key>'),
    'build/entitlements.mac.plist must declare keychain-access-groups (issue #322 forward-stability)');
  assert.ok(xml.includes(`<string>${EXPECTED_GROUP}</string>`),
    `keychain-access-groups must contain exactly ${EXPECTED_GROUP} (TeamID.appId — a typo silently reintroduces #322)`);
});

test('the group prefix matches the Team ID configured in the signed builder', () => {
  const builder = fs.readFileSync(path.join(repoRoot, 'electron-builder.signed.cjs'), 'utf8');
  const teamId = EXPECTED_GROUP.split('.')[0];
  assert.ok(builder.includes(teamId),
    `electron-builder.signed.cjs must reference Team ID ${teamId} so the signing identity can honor the keychain group`);
});

test('the group appId matches package.json build.appId', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const appId = pkg?.build?.appId;
  const groupAppId = EXPECTED_GROUP.split('.').slice(1).join('.');
  assert.equal(groupAppId, appId,
    'the keychain-access-group appId segment must equal package.json build.appId');
});

test('helper (inherit) entitlements do NOT carry the keychain group', () => {
  // safeStorage runs in the main process only — helpers must not widen their keychain surface.
  const inherit = fs.readFileSync(INHERIT, 'utf8');
  assert.ok(!inherit.includes('keychain-access-groups'),
    'entitlements.mac.inherit.plist must NOT include keychain-access-groups (main-process-only capability)');
});

test('the build bakes keychainGroupEntitled so telemetry can prove the entitlement shipped', () => {
  const builder = fs.readFileSync(path.join(repoRoot, 'electron-builder.signed.cjs'), 'utf8');
  assert.ok(builder.includes('keychainGroupEntitled'),
    'electron-builder.signed.cjs must bake keychainGroupEntitled into extraMetadata for field telemetry');
});
