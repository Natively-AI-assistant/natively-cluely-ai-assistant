/**
 * Ticket 02 — donation cluster strip.
 * Source-contract style matches TrialBackendHardDisable.test.mjs (prior art).
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

test('orchestrator stageCatalog has no support stage', () => {
  const ts = read('src/lib/onboarding/stageCatalog.ts');
  const mjs = read('src/lib/onboarding/stageCatalog.mjs');

  assert.doesNotMatch(ts, /id:\s*['"]support['"]/);
  assert.doesNotMatch(mjs, /id:\s*['"]support['"]/);
  assert.doesNotMatch(ts, /['"]support['"]\s*,/);
  assert.doesNotMatch(mjs, /['"]support['"]\s*,/);
});

test('donation IPC never schedules SupportToaster / never reports shouldShow', () => {
  const handlers = read('electron/ipcHandlers.ts');
  const start = handlers.search(/safeHandle\(['"]get-donation-status['"]/);
  assert.ok(start >= 0, 'get-donation-status handler should exist (stub or removed with call sites)');
  const end = handlers.search(/safeHandle\(['"]/, start + 1);
  const body = handlers.slice(start, end > start ? end : start + 400);

  // Must not consult live DonationManager cadence for UI scheduling.
  assert.doesNotMatch(body, /shouldShowToaster\s*\(/);
  assert.match(body, /shouldShow:\s*false/);
});

test('UI surfaces have no Buy Me a Coffee / support-us / star-donation CTAs', () => {
  const about = read('src/components/AboutSection.tsx');
  const spotlight = read('src/components/FeatureSpotlight.tsx');
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');
  const app = read('src/App.tsx');

  assert.doesNotMatch(about, /buymeacoffee\.com/i);
  assert.doesNotMatch(about, /Support Project|Support Development|Star on GitHub|Support us by starring/);
  assert.doesNotMatch(spotlight, /support_natively|buymeacoffee\.com|type:\s*['"]support['"]/);
  assert.doesNotMatch(host, /SupportToaster/);
  assert.doesNotMatch(app, /getDonationStatus|donationShouldShow/);
});

test('DonationManager does not drive product UI scheduling', () => {
  const handlers = read('electron/ipcHandlers.ts');
  // Live mark/complete may remain as no-ops, but must not require DonationManager for show.
  assert.doesNotMatch(
    handlers,
    /get-donation-status[\s\S]{0,500}DonationManager/,
    'get-donation-status must not load DonationManager',
  );
});
