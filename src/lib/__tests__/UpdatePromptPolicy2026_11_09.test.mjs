// L3 (2026-11-09): the update card waits its turn, and a close holds for the
// same version.
//
// <UpdateBanner/> was mounted outside the card scheduler and the Welcome gate,
// so its dimmed full-window card could open over the Welcome, Settings, an
// onboarding card or Trial ended, and its close was memory-only, so the same
// version opened it again every launch. The scheduler side (claimExternalCard)
// is launchCardLimit2026_11_09.test.mjs.
//
// Run: node --test src/lib/__tests__/UpdatePromptPolicy2026_11_09.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UPDATE_DISMISSAL_KEY, UPDATE_DISMISS_SNOOZE_MS, normalizeUpdateVersion, readUpdateDismissal, writeUpdateDismissal, isUpdateDismissed,
} from '../updatePromptPolicy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const NOW = 1_800_000_000_000;
const D = 86_400_000;
const mem = () => {
  const m = new Map();
  return { m, s: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } };
};

test('a closed version stays closed for 7 days; a newer one shows', () => {
  assert.equal(UPDATE_DISMISS_SNOOZE_MS, 7 * D);
  const { s } = mem();
  writeUpdateDismissal(s, 'v3.1.0', NOW);
  const d = readUpdateDismissal(s);
  assert.deepEqual(d, { version: '3.1.0', at: NOW });
  assert.equal(isUpdateDismissed(d, '3.1.0', NOW + D), true);
  assert.equal(isUpdateDismissed(d, 'v3.1.0', NOW + 7 * D - 1), true, '"v" prefix is the same version');
  assert.equal(isUpdateDismissed(d, '3.1.0', NOW + 7 * D), false, 'back after 7 days');
  assert.equal(isUpdateDismissed(d, '3.1.1', NOW + D), false, 'a newer version opens as usual');
});

test('nothing stored, or a broken store: nothing is held back', () => {
  assert.equal(isUpdateDismissed(null, '3.1.0', NOW), false);
  assert.equal(readUpdateDismissal(null), null);
  assert.equal(readUpdateDismissal({ getItem: () => { throw new Error('denied'); } }), null);
  assert.equal(readUpdateDismissal({ getItem: () => '{bad' }), null);
  assert.equal(readUpdateDismissal({ getItem: () => JSON.stringify({ version: '', at: NOW }) }), null);
  assert.doesNotThrow(() => writeUpdateDismissal({ setItem: () => { throw new Error('quota'); } }, '3.1.0', NOW));
  const { m, s } = mem();
  writeUpdateDismissal(s, '', NOW);
  assert.equal(m.has(UPDATE_DISMISSAL_KEY), false, 'no version, nothing written');
  assert.equal(isUpdateDismissed({ version: '3.1.0', at: NOW }, undefined, NOW), false);
});

test('a clock set backwards only delays', () => {
  assert.equal(isUpdateDismissed({ version: '3.1.0', at: NOW + 3 * D }, '3.1.0', NOW), true);
  assert.equal(normalizeUpdateVersion(' V3.2.0 '), '3.2.0');
});

// ── Wiring (source-level: UpdateBanner and App need a DOM and the bridge) ──
const banner = fs.readFileSync(path.resolve(here, '../../components/UpdateBanner.tsx'), 'utf8');
const app = fs.readFileSync(path.resolve(here, '../../App.tsx'), 'utf8');

test('an available update that was closed recently does not open the card', () => {
  const i = banner.indexOf('onUpdateAvailable(');
  const block = banner.slice(i, banner.indexOf('onDownloadProgress', i));
  const check = block.indexOf('isUpdateDismissed(readUpdateDismissal(localStore()), info?.version, Date.now())');
  assert.notEqual(check, -1);
  assert.ok(check < block.indexOf('setIsVisible(true)'), 'checked before the card is asked to open');
});

test('the user closing the card or its toast records the version; the macOS release-page path does not', () => {
  assert.match(banner, /const handleUserClose = \(\) => \{[\s\S]*?writeUpdateDismissal\(localStore\(\), updateInfo\?\.version, Date\.now\(\)\);/);
  assert.match(banner, /onClose=\{handleUserClose\}/);
  const install = banner.slice(banner.indexOf('const handleInstall'), banner.indexOf('const handleDismiss'));
  assert.match(install, /window\.electronAPI\.platform === 'darwin'/, 'the unsigned-macOS release-page path is kept');
  assert.match(install, /openExternal\(parsedNotes\?\.url \|\| LATEST_RELEASE_URL\);\s*handleClose\(\);/);
  assert.match(install, /setStatus\('downloading'\);\s*window\.electronAPI\.downloadUpdate\(\);/, 'the in-place path (Windows, signed macOS) is kept');
});

test('the card opens only when nothing else holds the screen, and holds the scheduler slot', () => {
  assert.match(banner, /isOpen=\{cardOpen\}/);
  assert.match(banner, /const cardOpen = wantsCard && holdsSlot;/);
  assert.match(app, /const updateCardMayOpen = !showStartup && showWelcome === false && !isSettingsOpen && !isManagerOpen\s*&& !showTrialExpiredModal && !trialEndedDue && !orchState\?\.activeToasterId;/);
  assert.match(app, /<UpdateBanner canOpen=\{updateCardMayOpen\} claimSlot=\{claimUpdateSlot\} releaseSlot=\{releaseUpdateSlot\} \/>/);
  assert.match(app, /orch\.claimExternalCard\('update'\)/);
  assert.match(app, /orch\?\.releaseExternalCard\('update'\)/);
});
