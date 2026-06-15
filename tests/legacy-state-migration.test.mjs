import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const aiProvidersPath = new URL('../src/components/settings/AIProvidersSettings.tsx', import.meta.url);
const settingsOverlayPath = new URL('../src/components/SettingsOverlay.tsx', import.meta.url);
const settingsPopupPath = new URL('../src/components/SettingsPopup.tsx', import.meta.url);
const profileIntelligencePath = new URL('../src/components/ProfileIntelligenceSettings.tsx', import.meta.url);
const appPath = new URL('../src/App.tsx', import.meta.url);
const ipcHandlersPath = new URL('../electron/ipcHandlers.ts', import.meta.url);
const preloadPath = new URL('../electron/preload.ts', import.meta.url);
const typesPath = new URL('../src/types/electron.d.ts', import.meta.url);

test('AIProvidersSettings does not expose natively as a selectable default model', () => {
  const source = readFileSync(aiProvidersPath, 'utf8');
  assert.equal(/id:\s*['"]natively['"]/.test(source), false);
  assert.match(source, /sanitizeDefaultModel\(result\.model\)/);
});

test('SettingsOverlay sanitizes legacy natively STT provider state', () => {
  const source = readFileSync(settingsOverlayPath, 'utf8');
  assert.match(source, /sanitizeSttProvider\(creds\.sttProvider\)/);
  assert.equal(/sttProvider === 'natively'/.test(source), false);
});

test('preload and typed IPC contract do not expose removed paywall APIs', () => {
  const preload = readFileSync(preloadPath, 'utf8');
  const types = readFileSync(typesPath, 'utf8');
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
    'onTrialEnded',
    'onLicenseStatusChanged',
  ]) {
    assert.equal(preload.includes(needle), false, `preload still exposes ${needle}`);
    assert.equal(types.includes(needle), false, `types still expose ${needle}`);
  }
});

test('live settings surfaces do not call removed premium or Natively usage APIs', () => {
  const settingsPopup = readFileSync(settingsPopupPath, 'utf8');
  const profileIntelligence = readFileSync(profileIntelligencePath, 'utf8');
  const app = readFileSync(appPath, 'utf8');

  for (const [name, source] of [
    ['SettingsPopup', settingsPopup],
    ['ProfileIntelligenceSettings', profileIntelligence],
    ['App', app],
  ]) {
    for (const needle of [
      'licenseCheckPremium',
      'licenseGetDetails',
      'PremiumUpgradeModal',
      'setIsPremiumModalOpen',
      'Requires Pro license',
      'Unlock Pro',
      'Upgrade to Pro',
      'NativelyQuotaBanner',
      'getNativelyUsage',
    ]) {
      assert.equal(source.includes(needle), false, `${name} still references ${needle}`);
    }
  }
});

test('removed IPC handlers are compatibility stubs without dead legacy bodies', () => {
  const source = readFileSync(ipcHandlersPath, 'utf8');
  for (const needle of [
    "require('../premium/electron/services/LicenseManager')",
    'https://api.natively.software/v1/pricing',
    'https://api.natively.software/v1/usage',
    'https://api.natively.software/v1/trial/start',
    'https://api.natively.software/v1/trial/status',
    'https://api.natively.software/v1/trial/convert',
    'activateWithApiKey',
    'activateLicense',
  ]) {
    assert.equal(source.includes(needle), false, `ipcHandlers still contains legacy ${needle}`);
  }
  assert.match(source, /safeHandle\('license:check-premium'[\s\S]*?return false;/);
  assert.match(source, /safeHandle\('set-natively-api-key'[\s\S]*?Hosted API removed in this build/);
  assert.match(source, /safeHandle\('trial:start'[\s\S]*?Free trial removed in this build/);
});
