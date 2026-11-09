// First-run guide, Settings: step 6 (Plans & Billing), step 7 (own keys) and
// "Show the guide again" in Help.
// Run: node --test src/components/__tests__/FirstRunGuideSettings2026_11_10.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Settings marks its Plans and AI Providers nav items and draws the guide', () => {
  const s = read('src/components/SettingsOverlay.tsx');
  assert.ok(s.includes('data-guide="nav-plans"'));
  assert.ok(s.includes('data-guide="nav-ai-providers"'));
  assert.ok(s.includes('<SettingsGuide'));
});

test('SettingsGuide: honest trial copy, purchases and keys move the guide, AI provider first', () => {
  const g = read('src/components/guide/SettingsGuide.tsx');
  for (const s of ["type: 'own_keys'", "type: 'keys_done'", "type: 'plan_changed'", 'getTrialStatus', 'licenseGetDetails',
    'getStoredCredentials', 'getSttProvider', 'getEmbeddingStatus', 'onCredentialsChanged', 'onLicenseStatusChanged',
    "'Your free trial is almost used up.'", "'Your free trial is used up.'", "'Your free trial isn’t available on this device.'",
    "'Use my own keys'", "'Set up Natively your way.'", '[data-guide="nav-plans"]', '[data-guide="nav-ai-providers"]']) {
    assert.ok(g.includes(s), s);
  }
  const order = ["tr('AI provider')", "tr('Speech-to-text')", "tr('Retrieval')"].map((s) => g.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'AI provider, then speech-to-text, then retrieval');
});

test('Help can show the guide again', () => {
  const h = read('src/components/settings/HelpSettings.tsx');
  assert.ok(h.includes("t('Show the guide again')"));
  assert.ok(h.includes('onShowGuide'));
  const s = read('src/components/SettingsOverlay.tsx');
  assert.ok(/onShowGuide=\{\(\) => \{ dispatchGuide\(\{ type: 'restart' \}\); onClose\(\); \}\}/.test(s));
});
