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

  // For each upload IPC, the renderer call site must short-circuit through the
  // upgrade modal before opening the OS file picker.
  const UPLOAD_CALL_SITES = [
    { ipc: 'profileUploadResume', label: 'resume upload button' },
    { ipc: 'profileUploadJD',     label: 'job description upload button' },
  ];

  for (const { ipc, label } of UPLOAD_CALL_SITES) {
    test(`${label} (calls ${ipc}) gates at click via setIsPremiumModalOpen before profileSelectFile`, () => {
      const ipcIdx = source.indexOf(ipc);
      assert.ok(ipcIdx >= 0, `Call site for ${ipc} not found`);

      // Walk back to the enclosing onClick={async () => { … }. We bound the
      // handler at its onClick={ open brace and at the corresponding ipc call.
      const onClickIdx = source.lastIndexOf('onClick={async () => {', ipcIdx);
      assert.ok(onClickIdx >= 0, `onClick handler for ${ipc} not found`);

      const handler = source.slice(onClickIdx, ipcIdx);

      // The picker must NOT run before the gate. We assert ordering:
      // setIsPremiumModalOpen must appear earlier than profileSelectFile.
      const gateIdx   = handler.indexOf('setIsPremiumModalOpen(true)');
      const pickerIdx = handler.indexOf('profileSelectFile');

      assert.ok(
        gateIdx >= 0,
        `Handler for ${ipc} must call setIsPremiumModalOpen(true) when the user is not Pro`
      );
      assert.ok(pickerIdx >= 0, `Handler for ${ipc} unexpectedly missing profileSelectFile call`);
      assert.ok(
        gateIdx < pickerIdx,
        `Handler for ${ipc}: setIsPremiumModalOpen (idx ${gateIdx}) must precede profileSelectFile (idx ${pickerIdx}) so the file picker never opens for Free Tier users`
      );

      // The gate must be guarded by !hasProfileAccess so the picker still works
      // for Pro / trial users.
      assert.ok(
        /!\s*hasProfileAccess/.test(handler),
        `Handler for ${ipc} must guard the gate with !hasProfileAccess so Pro users are unaffected`
      );
    });
  }

  // A user-visible Pro affordance must appear next to each upload button so
  // the gating is discoverable BEFORE the click — that is the core of #267.
  // We use a unique marker class on the badge so it is unambiguously rendered
  // in both upload cards (and not confused with the existing 'Requires Pro
  // license' tooltip on the unrelated Profile Mode toggle).
  test('both upload cards render a pi-upload-pill__pro-badge for non-Pro users', () => {
    const markers = source.match(/pi-upload-pill__pro-badge/g) ?? [];
    assert.ok(
      markers.length >= 2,
      `Expected the pi-upload-pill__pro-badge class to render in both the resume and JD upload cards, found ${markers.length} occurrence(s)`
    );
  });
});
