// The keys and code the card ledger replaced are gone (toaster policy Phase 4,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §9).
//
// Every one of these was either written and never read, or a route nothing
// calls. The renderer's one-time legacy import (src/lib/cards/rendererLegacy.mjs)
// still READS its legacy keys for users who have not been migrated yet; only
// the writers go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const premium = existsSync(join(root, 'premium/src')) ? false : 'premium not checked out';

test('the extension card writes no dismiss flag (the ledger decides)', () => {
  const src = read('src/components/onboarding/BrowserExtensionToaster.tsx');
  assert.ok(!src.includes('natively_ext_connect_dismissed_v1'));
  assert.ok(!/persistDismiss/.test(src));
});

test('the ads write no cooldown stamps (useAdCampaigns read them; it is gone)', { skip: premium }, () => {
  for (const f of ['ProfileFeatureToaster', 'JDAwarenessToaster', 'MaxUltraUpgradeToaster', 'NativelyApiPromoToaster']) {
    const src = read(`premium/src/${f}.tsx`);
    assert.ok(!/STORAGE_KEY|stamp\(\)/.test(src), f);
  }
  assert.ok(!existsSync(join(root, 'premium/src/useAdCampaigns.ts')), 'the scheduler it replaced');
});

test('the premium entry exports no ad scheduler', () => {
  const idx = read('src/premium/index.tsx');
  assert.ok(!idx.includes('useAdCampaigns'));
});

test('App mounts no ad outside the orchestrator host and writes no dead flag', () => {
  const app = read('src/App.tsx');
  assert.ok(!app.includes('natively_show_profile_toaster'));
  for (const c of ['<NativelyApiPromoToaster', '<ProfileFeatureToaster', '<JDAwarenessToaster', '<MaxUltraUpgradeToaster']) {
    assert.ok(!app.includes(c), `${c} belongs to the orchestrator host`);
  }
});

test('the orchestrator has no queue:set event (nothing sends it)', () => {
  assert.ok(!read('src/lib/onboarding/orchestrator.ts').includes('queue:set'));
});

test('no IPC nobody calls: review:record-session, trial:wipe-profile-data', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');
  for (const [channel, api] of [['review:record-session', 'reviewRecordSession'], ['trial:wipe-profile-data', 'wipeTrialProfileData:']]) {
    assert.ok(!ipc.includes(`'${channel}'`), channel);
    assert.ok(!preload.includes(`'${channel}'`) && !preload.includes(api), `${channel} (preload)`);
    assert.ok(!types.includes(api), `${channel} (types)`);
  }
});

test('no unused constants: DonationManager.SHOW_DELAY_MS, the banner\'s PLAN_PRO_URL', () => {
  assert.ok(!read('electron/DonationManager.ts').includes('SHOW_DELAY_MS'));
  // The banner itself was removed on 2026-10-04, PLAN_PRO_URL with it.
  assert.ok(!existsSync(join(root, 'src/components/trial/FreeTrialBanner.tsx')));
});

test('the legacy READS stay for users not yet migrated', () => {
  const legacy = read('src/lib/cards/rendererLegacy.mjs');
  assert.ok(legacy.includes('natively_dismissed_campaigns'));
});
