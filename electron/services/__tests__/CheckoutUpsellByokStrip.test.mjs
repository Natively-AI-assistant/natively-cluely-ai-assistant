/**
 * Ticket 04 / commercial-surface-strip — checkout/upsell strip + BYOK settings.
 * Source-contract style matches DonationClusterStrip / TrialBackendHardDisable.
 *
 * Run: node --test electron/services/__tests__/CheckoutUpsellByokStrip.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

test('Natively API settings keeps BYOK key entry without checkout storefront', () => {
  const api = read('src/components/settings/NativelyApiSettings.tsx');

  // BYOK surface must remain.
  assert.match(api, /setNativelyApiKey/);
  assert.match(api, /Save key|save.*key/i);

  // Storefront / marketing must be gone.
  assert.doesNotMatch(api, /INSIDER20/);
  assert.doesNotMatch(api, /checkout\.dodopayments\.com/);
  assert.doesNotMatch(api, /customer\.dodopayments\.com/);
  assert.doesNotMatch(api, /Choose a Plan|Get Started with/);
  assert.doesNotMatch(api, /Start 10-Minute Free Trial|Free Trial Active/);
  assert.doesNotMatch(api, /FreeTrialModal/);
});

test('settings overlay has keys path, not Pro storefront tab', () => {
  const overlay = read('src/components/SettingsOverlay.tsx');

  assert.match(overlay, /natively-api|NativelyApiSettings/);
  assert.doesNotMatch(overlay, /NativelyProSettings/);
  // Nav label / mount for storefront tab must be gone (remap of stale initialTab is OK).
  assert.doesNotMatch(overlay, /setActiveTab\(['"]natively-pro['"]\)/);
  assert.doesNotMatch(overlay, /<span>\s*Natively Pro\s*<\/span>/);
  assert.doesNotMatch(overlay, /activeTab === ['"]natively-pro['"]/);
});

test('App / Profile Intelligence have no Unlock Pro / quota-upgrade / PremiumUpgrade CTA', () => {
  const app = read('src/App.tsx');
  const pi = read('src/components/ProfileIntelligenceSettings.tsx');
  const popup = read('src/components/SettingsPopup.tsx');

  assert.doesNotMatch(app, /<\s*NativelyQuotaBanner\b/);
  assert.doesNotMatch(app, /<\s*PremiumUpgradeModal\b/);
  assert.doesNotMatch(app, /import\s+\{\s*NativelyQuotaBanner/);

  assert.doesNotMatch(pi, /Unlock Pro/);
  assert.doesNotMatch(pi, /PremiumUpgradeModal/);
  assert.doesNotMatch(pi, /Requires Pro\.|Requires Pro license/);
  // Access must not be gated solely for upsell (license bypass alignment).
  assert.doesNotMatch(pi, /hasProfileAccess\s*=\s*isPremium\s*\|\|\s*isTrialActive/);

  assert.doesNotMatch(popup, /Requires Pro license to be active/);
  // Profile Mode must not be greyscaled behind a Pro license gate.
  assert.doesNotMatch(popup, /Requires Pro license[\s\S]{0,80}grayscale|grayscale[\s\S]{0,80}Requires Pro license/);
  assert.doesNotMatch(popup, /title=\{!isPremium \? 'Requires Pro/);
});

test('upsell-only CHECKOUT_URLS / PREMIUM_ENABLED cosmetics are removed', () => {
  assert.equal(exists('src/config/urls.ts'), false, 'CHECKOUT_URLS module should be deleted');
  assert.equal(exists('src/lib/featureFlags.ts'), false, 'PREMIUM_ENABLED featureFlags should be deleted');
});
