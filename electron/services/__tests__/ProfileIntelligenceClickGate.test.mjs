// electron/services/__tests__/ProfileIntelligenceClickGate.test.mjs
//
// Ticket 04 / commercial-surface-strip — client gates align with license bypass.
// Upload flows must open without Unlock Pro / PremiumUpgradeModal upsell.
//
// Prior art (issue #267) required click-time Pro gates; those are removed under ADR 0001.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../../src/components/ProfileIntelligenceSettings.tsx');

describe('Profile Intelligence renderer: Pro UI without unlock upsell', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  test('no PremiumUpgradeModal / Unlock Pro / Requires Pro upsell', () => {
    assert.doesNotMatch(source, /PremiumUpgradeModal/);
    assert.doesNotMatch(source, /Unlock Pro/);
    assert.doesNotMatch(source, /Requires Pro\.|Requires Pro license/);
    assert.doesNotMatch(source, /setIsPremiumModalOpen/);
    assert.doesNotMatch(source, /hasProfileAccess\s*=\s*isPremium\s*\|\|\s*isTrialActive/);
  });

  test('resume and JD upload paths call profileSelectFile without upgrade short-circuit', () => {
    assert.match(source, /profileSelectFile/);
    assert.match(source, /profileUploadResume/);
    assert.match(source, /profileUploadJD/);
    // No click-time upgrade gate before the OS file picker.
    assert.doesNotMatch(source, /setIsPremiumModalOpen\(true\)[\s\S]{0,200}profileSelectFile/);
    assert.doesNotMatch(source, /pi-upload-pill__pro-badge/);
  });
});
