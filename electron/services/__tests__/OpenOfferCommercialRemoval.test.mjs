import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('OpenOffer commercial-path removal', () => {
  const ipcSource = read('electron/ipcHandlers.ts');
  const preloadSource = read('electron/preload.ts');
  const electronTypes = read('src/types/electron.d.ts');

  test('profile intelligence is not gated by Pro or trial entitlement', () => {
    assert.match(
      ipcSource,
      /const isProOrTrialActive = \(\): boolean => \{\s*return true;\s*\};/,
      'profile features should remain available without premium/trial entitlement',
    );
    assert.doesNotMatch(ipcSource, /LicenseManager\.getInstance\(\)\.isPremium/);
    assert.doesNotMatch(ipcSource, /getTrialToken\(\).*getTrialExpiresAt\(\)/s);
  });

  test('removed license, trial, and hosted API handlers are inert compatibility stubs', () => {
    const expectations = [
      ['license:activate', /Premium features were removed in this build/],
      ['license:check-premium', /return false;/],
      ['license:get-details', /isPremium: false/],
      ['license:check-premium-async', /return false;/],
      ['set-natively-api-key', /Hosted API removed in this build/],
      ['get-natively-pricing', /Hosted API removed in this build/],
      ['get-natively-usage', /Hosted API removed in this build/],
      ['trial:start', /Free trial removed in this build/],
      ['trial:status', /Free trial removed in this build/],
      ['trial:get-local', /hasToken: false/],
      ['trial:convert', /ok: true/],
      ['trial:end-byok', /success: true/],
      ['trial:wipe-profile-data', /success: true/],
    ];

    for (const [channel, pattern] of expectations) {
      const block = sliceSafeHandleBlock(ipcSource, channel);
      assert.match(block, pattern, `${channel} should be a compatibility stub`);
      assert.doesNotMatch(block, /fetch\(/, `${channel} must not call network APIs`);
      assert.doesNotMatch(block, /LicenseManager/, `${channel} must not load premium modules`);
    }
  });

  test('renderer contract does not expose removed commercial APIs', () => {
    const combined = `${preloadSource}\n${electronTypes}`;
    for (const needle of [
      'setNativelyApiKey',
      'getNativelyPricing',
      'getNativelyUsage',
      'startTrial',
      'getTrialStatus',
      'getLocalTrial',
      'convertTrial',
      'endTrialByok',
      'wipeTrialProfileData',
      'licenseActivate',
      'licenseCheckPremium',
      'licenseGetDetails',
      'licenseCheckPremiumAsync',
      'licenseDeactivate',
      'licenseGetHardwareId',
    ]) {
      assert.equal(combined.includes(needle), false, `renderer contract still exposes ${needle}`);
    }
  });

  test('live renderer surfaces do not expose removed hosted provider or trial CTAs', () => {
    const liveRenderer = [
      'src/components/SettingsOverlay.tsx',
      'src/components/settings/Sidebar.tsx',
      'src/components/settings/AIProvidersSettings.tsx',
      'src/components/settings/HelpSettings.tsx',
      'src/components/ModelSelectorWindow.tsx',
      'src/components/ui/ModelSelector.tsx',
      'src/components/SettingsPopup.tsx',
      'src/components/trial/TrialPromoToaster.tsx',
      'src/components/trial/FreeTrialBanner.tsx',
      'src/config/stt.constants.ts',
    ].map(read).join('\n');

    for (const needle of [
      'Natively API',
      'Natively Pro',
      'Start free trial',
      'checkout.dodopayments',
      "id: 'natively'",
      'provider: \'natively\'',
      'hasNativelyKey',
    ]) {
      assert.equal(liveRenderer.includes(needle), false, `live renderer still exposes ${needle}`);
    }
  });

  test('runtime provider registries cannot route to removed hosted provider', () => {
    const runtimeSources = [
      'electron/services/CredentialsManager.ts',
      'electron/main.ts',
      'electron/ipcHandlers.ts',
      'electron/services/screen/VisionProviderRegistry.ts',
      'electron/llm/ProviderRouter.ts',
    ].map(read).join('\n');

    assert.doesNotMatch(runtimeSources, /NativelyProSTT/);
    assert.doesNotMatch(runtimeSources, /id:\s*['"]natively['"]/);
    assert.doesNotMatch(runtimeSources, /provider:\s*['"]natively['"]/);
    assert.doesNotMatch(runtimeSources, /name:\s*['"]Natively API['"]/);
    assert.doesNotMatch(runtimeSources, /sttProvider\s*=\s*['"]natively['"]/);
    assert.doesNotMatch(runtimeSources, /defaultModel\s*=\s*['"]natively['"]/);
  });
});
