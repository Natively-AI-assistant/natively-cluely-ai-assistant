// Entitlement-shape guard — INVERTED 2026-08-19.
//
// This file used to REQUIRE `keychain-access-groups` in build/entitlements.mac.plist (issue #322
// forward-stability, commit 0a1fd18e). That entitlement is RESTRICTED: macOS only honours it when
// the signed bundle embeds a matching provisioning profile. Signed 2.8.6 shipped with
// `provisioningProfile=none`, AMFI rejected the binary at exec with
// `AppleMobileFileIntegrityError Code=-413 "No matching profile found"`, and the app could not
// launch at all — while spctl, `codesign --verify --deep --strict` and `stapler validate` all
// still reported the bundle as perfect, and no crash report was written.
//
// So the guard now pins the OPPOSITE: the entitlement must stay ABSENT until a Developer ID
// provisioning profile is actually embedded. Re-adding it alone ships an unlaunchable app, and
// nothing else in CI would catch that (unit CI never signs or executes the .app).
//
// To legitimately re-add it: register an App ID for com.electron.meeting-notes with Keychain
// Sharing, generate a Developer ID provisioning profile, set `mac.provisioningProfile` in
// electron-builder.signed.cjs, verify a signed build LAUNCHES, then update this test.
// Background: MACOS_LAUNCH_FAILURE_2026-08-19.md.
//
// Run via: node --test electron/services/__tests__/KeychainEntitlement.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TOP = path.join(repoRoot, 'build/entitlements.mac.plist');
const INHERIT = path.join(repoRoot, 'build/entitlements.mac.inherit.plist');
const BUILDER = path.join(repoRoot, 'electron-builder.signed.cjs');

// Comments in these files legitimately mention the entitlement by name; only a real
// <key>…</key> declaration is a launch-breaking regression.
const DECLARED = /<key>\s*keychain-access-groups\s*<\/key>/;

test('top-level entitlements do NOT declare keychain-access-groups', () => {
  assert.ok(!DECLARED.test(fs.readFileSync(TOP, 'utf8')),
    'build/entitlements.mac.plist must NOT declare keychain-access-groups: it is a restricted, ' +
    'profile-requiring entitlement and without an embedded provisioning profile AMFI kills the ' +
    'app at exec (POSIX 163 "Launchd job spawn failed"). See MACOS_LAUNCH_FAILURE_2026-08-19.md.');
});

test('helper (inherit) entitlements do NOT declare keychain-access-groups', () => {
  assert.ok(!DECLARED.test(fs.readFileSync(INHERIT, 'utf8')),
    'build/entitlements.mac.inherit.plist must NOT declare keychain-access-groups');
});

test('no provisioning profile is configured, matching the entitlement set we sign with', () => {
  // The two must move together. If mac.provisioningProfile is ever added, the restricted
  // entitlement becomes legal again — and this test is the reminder to revisit it deliberately
  // rather than have the pair drift apart in either direction.
  const builder = fs.readFileSync(BUILDER, 'utf8');
  const configuresProfile = /^\s*provisioningProfile\s*:/m.test(builder);
  assert.equal(configuresProfile, false,
    'electron-builder.signed.cjs configures mac.provisioningProfile — if that is intentional, ' +
    're-evaluate keychain-access-groups and update this test together with it');
});

test('the signed build still bakes nativelySigned for the auto-update path', () => {
  // keychainGroupEntitled was removed alongside the entitlement (it existed only to prove the
  // entitlement shipped). nativelySigned is unrelated and must survive.
  const builder = fs.readFileSync(BUILDER, 'utf8');
  assert.ok(builder.includes('nativelySigned'),
    'electron-builder.signed.cjs must keep nativelySigned in extraMetadata');
  // Match a real property assignment, not the word appearing in the explanatory comment
  // that replaced it — a substring check here would fail on its own documentation.
  assert.ok(!/^\s*keychainGroupEntitled\s*:/m.test(builder),
    'keychainGroupEntitled must not be assigned in extraMetadata: it advertised an entitlement ' +
    'we no longer ship');
});

// AMFI parses the entitlements XML with a stricter parser than plutil. A `--` sequence inside an
// XML comment is illegal, and `plutil -lint` accepts it while codesign fails with
// "Failed to parse entitlements: AMFIUnserializeXML: syntax error" and SILENTLY LEAVES THE OLD
// SIGNATURE IN PLACE. Hit for real on 2026-08-19 by a comment containing a `codesign` flag list.
for (const [label, file] of [['top-level', TOP], ['inherit', INHERIT]]) {
  test(`${label} entitlements contain no '--' inside XML comments (AMFI parser is strict)`, () => {
    const xml = fs.readFileSync(file, 'utf8');
    for (const body of xml.match(/<!--[\s\S]*?-->/g) ?? []) {
      const inner = body.slice(4, -3);
      assert.ok(!inner.includes('--'),
        `illegal '--' inside an XML comment in ${path.basename(file)} — AMFI rejects it and ` +
        `codesign then keeps the previous signature:\n${inner.split('\n').find(l => l.includes('--'))}`);
    }
  });
}
