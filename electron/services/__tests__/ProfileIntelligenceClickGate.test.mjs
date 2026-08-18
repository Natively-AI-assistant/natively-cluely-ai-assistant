// electron/services/__tests__/ProfileIntelligenceClickGate.test.mjs
//
// Verifies the Profile Intelligence renderer gates the resume + JD upload
// buttons at the *click*, not after the OS file picker has run. Without this
// gate, Free-Tier users open the picker, choose a file, and only then see a
// tiny red error banner — they read this as a silent failure (issue #267).
//
// We follow the same source-level pattern as ProfileIntelligenceGate.test.mjs:
// no JSX runtime, no jsdom. The renderer is plain text that must contain the
// gate clause inside each upload onClick handler.
//
// The contract is: each upload onClick handler must invoke
// setIsPremiumModalOpen(true) and return BEFORE calling profileSelectFile()
// whenever hasProfileAccess is false.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../../src/components/ProfileIntelligenceSettings.tsx');

describe('Profile Intelligence renderer: click-time Pro gate', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  // Sanity: the file still imports the upgrade modal and exposes the setter.
  test('component imports PremiumUpgradeModal and tracks hasProfileAccess', () => {
    assert.ok(source.includes('PremiumUpgradeModal'), 'PremiumUpgradeModal import missing');
    assert.ok(source.includes('hasProfileAccess'), 'hasProfileAccess flag missing');
    assert.ok(source.includes('setIsPremiumModalOpen'), 'modal setter missing');
  });

  // THE GATE MOVED TO A CHOKE POINT. This used to walk back from each upload
  // IPC to an enclosing `onClick={async () => {` and assert the gate inline at
  // that call site. The upload flow has since been refactored: the picker is
  // reached through the shared `browseResume` / `browseJD` helpers, and the
  // buttons are presentational (FileUploadEmpty takes hasAccess/onNeedUpgrade/
  // onBrowse). No `onClick={async () => {` wraps the IPC any more, so the old
  // locator matched nothing.
  //
  // Rewritten to assert the gate where it now belongs — and this is STRICTER
  // than what it replaced. The per-button form only proved that the buttons it
  // knew about were gated; it could not see a new call site. In fact one had
  // already appeared: the "Re-upload" button in the heuristic-extraction notice
  // wires onClick={browseResume} directly, and it renders whenever
  // `hasProfile && extractionMode === 'heuristic'` — which a user whose Pro or
  // trial has LAPSED still satisfies, because the stored profile outlives the
  // entitlement. That was a live bypass to the OS file picker. Gating the shared
  // helper closes it for every present and future caller.
  const BROWSE_HELPERS = [
    { fn: 'browseResume', label: 'resume' },
    { fn: 'browseJD',     label: 'job description' },
  ];

  for (const { fn, label } of BROWSE_HELPERS) {
    test(`${label} picker helper (${fn}) gates on hasProfileAccess BEFORE profileSelectFile`, () => {
      const declIdx = source.indexOf(`const ${fn} = async () => {`);
      assert.ok(declIdx >= 0, `${fn} declaration not found`);
      const pickerIdx = source.indexOf('profileSelectFile', declIdx);
      assert.ok(pickerIdx >= 0, `${fn} must reach profileSelectFile`);
      const body = source.slice(declIdx, pickerIdx);

      assert.match(
        body,
        /if\s*\(!hasProfileAccess\)\s*\{\s*setIsPremiumModalOpen\(true\);\s*return;\s*\}/,
        `${fn} must short-circuit to the upgrade modal before opening the file picker — ` +
        'without this, any button wired straight to the helper (e.g. "Re-upload") bypasses Pro',
      );
    });
  }

  test('every call site that opens the picker goes through the gated helpers', () => {
    // Belt-and-braces: no component may call profileSelectFile directly, which
    // would sidestep the helper gate above.
    const direct = [...source.matchAll(/profileSelectFile/g)].length;
    const inHelpers = [...source.matchAll(/const browse(?:Resume|JD) = async \(\) => \{[\s\S]*?profileSelectFile/g)].length;
    assert.equal(direct, inHelpers,
      'profileSelectFile must only be reached from browseResume/browseJD, which carry the Pro gate');
  });

  test('the upgrade modal is still what an ungated click opens', () => {
    assert.ok(source.includes('PremiumUpgradeModal'), 'PremiumUpgradeModal import missing');
    assert.ok(source.includes('onNeedUpgrade'), 'presentational upload slots must still expose onNeedUpgrade');
  });
});
