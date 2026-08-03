/**
 * Ticket 06 — commercial surface strip verify (aggregate cold-start / leftovers).
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

test('cold-start product hosts have no trial/donation/upsell/review/ads chrome mounts', () => {
  const app = read('src/App.tsx');
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');
  const about = read('src/components/AboutSection.tsx');
  const api = read('src/components/settings/NativelyApiSettings.tsx');

  for (const [name, src] of [
    ['App', app],
    ['OrchestratedToasterHost', host],
  ]) {
    assert.doesNotMatch(src, /<\s*FreeTrial(Banner|Modal)\b/, `${name}: no FreeTrial mount`);
    assert.doesNotMatch(src, /<\s*SupportToaster\b/, `${name}: no SupportToaster`);
    assert.doesNotMatch(src, /<\s*ReviewPromptHost\b/, `${name}: no ReviewPromptHost`);
    assert.doesNotMatch(src, /<\s*PremiumUpgradeModal\b/, `${name}: no PremiumUpgradeModal`);
    assert.doesNotMatch(src, /<\s*NativelyQuotaBanner\b/, `${name}: no quota upsell banner`);
  }

  assert.doesNotMatch(about, /buymeacoffee\.com/i);
  assert.doesNotMatch(api, /checkout\.dodopayments\.com/);
  assert.match(api, /apiKey|API [Kk]ey|provider/i, 'BYOK settings surface retained');
});

test('orphan trial/donation/review UI modules are deleted', () => {
  assert.equal(exists('src/components/trial/FreeTrialBanner.tsx'), false);
  assert.equal(exists('src/components/trial/FreeTrialModal.tsx'), false);
  assert.equal(exists('src/components/SupportToaster.tsx'), false);
  assert.equal(exists('electron/DonationManager.ts'), false);
  assert.equal(exists('src/components/settings/NativelyProSettings.tsx'), false);
  assert.equal(exists('src/components/NativelyQuotaBanner.tsx'), false);
  assert.equal(exists('src/components/ReviewPromptHost.tsx'), false);
  assert.equal(exists('src/components/ReviewModal.tsx'), false);
});

test('E2E enable-pro does not plant fake trial tokens', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.search(/safeHandle\(['"]__e2e__:enable-pro['"]/);
  assert.ok(start >= 0, '__e2e__:enable-pro should exist');
  const end = source.search(/safeHandle\(['"]__e2e__:[^'"]+['"]/, start + 1);
  const body = source.slice(start, end > start ? end : start + 800);
  assert.doesNotMatch(body, /setTrialToken\s*\(/);
  assert.doesNotMatch(body, /e2e-trial-token/);
  assert.match(body, /isProOrTrialActive\s*\(/);
});

test('product identity remains Natively; license bypass intact', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(String(pkg.productName || pkg.name), /Natively/i);
  const ipc = read('electron/ipcHandlers.ts');
  const gate = ipc.slice(ipc.indexOf('const isProOrTrialActive'), ipc.indexOf('const isProOrTrialActive') + 280);
  assert.match(gate, /return true/);
});
