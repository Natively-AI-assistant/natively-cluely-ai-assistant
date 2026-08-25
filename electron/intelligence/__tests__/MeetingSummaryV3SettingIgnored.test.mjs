// node:test — meetingSummaryV3 is now the UNCONDITIONAL default (2026-08-25); the
// experimental settings toggle was removed. This is the regression guard for the trap
// documented in the task: a user who persisted `meetingSummaryV3Enabled: false` through
// the (now-deleted) settings row must NOT get stuck on the legacy pipeline forever —
// isIntelligenceFlagEnabled must simply stop reading that SettingsManager key.
//
// Mechanism under test: SettingsManager.getInstance() (electron/intelligence/
// intelligenceFlags.ts's readSettingOverride) is anchored on the
// `globalThis.__nativelySettingsManagerV1__` singleton slot (see e.g.
// ScreenUnderstandingModeEnforcement2026_08_01.test.mjs / HindsightManager.test.mjs for
// the same pattern) — getInstance() hands back whatever already occupies that slot
// without ever calling `new SettingsManager()`, so a plain fake `{ get(key) {...} }`
// object dropped into the slot is enough to exercise the settings-override branch
// headlessly, with no Electron `app` and no touching a real settings.json.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntelligenceFlagEnabled,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

const SETTINGS_SLOT = '__nativelySettingsManagerV1__';
const ENV_KEYS = ['NATIVELY_MEETING_SUMMARY_V3', 'NATIVELY_FOLLOWUP_DRAFT_V2'];

let slotBefore;

function fakeSettings(values) {
  globalThis[SETTINGS_SLOT] = { get: (key) => values[key] };
}

beforeEach(() => {
  slotBefore = globalThis[SETTINGS_SLOT];
  for (const k of ENV_KEYS) delete process.env[k];
  __resetIntelligenceFlagsCache();
});

afterEach(() => {
  if (slotBefore === undefined) delete globalThis[SETTINGS_SLOT];
  else globalThis[SETTINGS_SLOT] = slotBefore;
  for (const k of ENV_KEYS) delete process.env[k];
  __resetIntelligenceFlagsCache();
});

describe('meetingSummaryV3 — settings override retired (permanently-on flag)', () => {
  test('a persisted meetingSummaryV3Enabled:false does NOT disable the flag (resolves true)', () => {
    // This is the exact trap: before the fix, readSettingOverride would read this
    // stale `false` and isIntelligenceFlagEnabled('meetingSummaryV3') would return
    // false with no UI left to flip it back — a permanent legacy-pipeline lock-in.
    fakeSettings({ meetingSummaryV3Enabled: false });
    assert.equal(
      isIntelligenceFlagEnabled('meetingSummaryV3'),
      true,
      'stale persisted false must be inert now that the setting is ignored',
    );
  });

  test('a persisted meetingSummaryV3Enabled:true is also inert (ignored, not just the false case)', () => {
    fakeSettings({ meetingSummaryV3Enabled: true });
    assert.equal(isIntelligenceFlagEnabled('meetingSummaryV3'), true);
  });

  test('NATIVELY_MEETING_SUMMARY_V3=0 still forces the flag off (operator kill-switch survives)', () => {
    fakeSettings({ meetingSummaryV3Enabled: true });
    process.env.NATIVELY_MEETING_SUMMARY_V3 = '0';
    __resetIntelligenceFlagsCache();
    assert.equal(
      isIntelligenceFlagEnabled('meetingSummaryV3'),
      false,
      'the env kill-switch must still work with the settings override retired',
    );
  });

  test('NATIVELY_MEETING_SUMMARY_V3=1 still forces the flag on explicitly', () => {
    process.env.NATIVELY_MEETING_SUMMARY_V3 = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('meetingSummaryV3'), true);
  });

  test('sibling flag followUpDraftV2 still honors its own persisted setting (not a blanket change)', () => {
    // Proves the fix is scoped to meetingSummaryV3 only — every other Meeting Notes V3
    // flag must keep reading its SettingsManager override exactly as before.
    fakeSettings({ followUpDraftV2Enabled: false });
    assert.equal(
      isIntelligenceFlagEnabled('followUpDraftV2'),
      false,
      'followUpDraftV2 must still honor a persisted override — this flag was not touched',
    );

    fakeSettings({ followUpDraftV2Enabled: true });
    assert.equal(isIntelligenceFlagEnabled('followUpDraftV2'), true);
  });
});
