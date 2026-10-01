// The one-time trial campaign, EXECUTED through the real `trial:get-local` handler
// out of the compiled bundle (src/lib/trialCampaign.mjs): a past user's local record
// of "already claimed" is forgotten, the trial promo card returns, and it happens
// once. A source-level assertion cannot tell a reset that runs from one that is
// never reached, which is the failure that would strand every returning user.
//
// The store backend (Keychain on macOS, DPAPI on Windows) sits behind safeStorage,
// faked here; nothing in the campaign reads process.platform.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/TrialCampaignIpc2026_09_29.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');
const DAY = 86_400_000;
const CAMPAIGN = '2026-09-29';

const handlers = new Map();
const sends = [];
let cm, sm, ledger, SENTINEL, userData, llmCalls = [];

before(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-campaign-ipc-'));
  const win = { isDestroyed: () => false, webContents: { send: (channel, data) => sends.push({ channel, data }) } };
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: false,
      getVersion: () => '0.0.0-test', getName: () => 'natively',
      on: noop, once: noop, off: noop, removeAllListeners: noop,
      whenReady: () => Promise.resolve(), isReady: () => true,
    },
    BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [win] }),
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      handleOnce: (channel, fn) => handlers.set(channel, fn),
      on: noop, once: noop, off: noop,
      removeHandler: noop, removeListener: noop, removeAllListeners: noop,
      listenerCount: () => 0, emit: noop,
    },
    dialog: {}, desktopCapturer: {}, shell: {}, systemPreferences: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => Buffer.from(b).toString('utf8'),
      getSelectedStorageBackend: () => 'basic_text',
    },
    nativeTheme: { on: noop }, screen: { on: noop },
    session: {}, globalShortcut: {}, Menu: {}, Tray: {}, clipboard: {},
  };
  const fakeNative = new Proxy({ getHardwareId: () => 'trial-campaign-test-hwid' }, {
    get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : function nativeStub() {}),
  });
  const origLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
    return origLoad.call(this, request, ...rest);
  };
  // Nothing here may reach the real server: /v1/trial/start spends a device's row.
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });

  const mod = require(COMPILED);
  const appState = {
    processingHelper: { getLLMHelper: () => ({
      setModel: (id) => llmCalls.push(['setModel', id]),
      setNativelyKey: (k) => llmCalls.push(['setNativelyKey', k]),
    }) },
    sendModelChanged: noop,
    reconfigureSttProvider: async () => {},
    getKnowledgeOrchestrator: () => null,
  };
  try { mod.initializeIpcHandlers(appState); } catch { /* app-lifecycle wiring only */ }

  cm = require(path.join(ROOT, 'dist-electron/electron/services/CredentialsManager.js')).CredentialsManager.getInstance();
  sm = require(path.join(ROOT, 'dist-electron/electron/services/SettingsManager.js')).SettingsManager.getInstance();
  ledger = require(path.join(ROOT, 'dist-electron/electron/services/cards/CardLedger.js')).CardLedger.getInstance();
  SENTINEL = require(path.join(ROOT, 'dist-electron/electron/config/constants.js')).TRIAL_SENTINEL_KEY;
});

const iso = (ms) => new Date(ms).toISOString();
const getLocal = () => handlers.get('trial:get-local')({});
const promoRetired = () => !!ledger.get().cards?.trial_promo?.retired;

test('the harness reached the handler (else every assertion below points the wrong way)', () => {
  assert.ok(handlers.has('trial:get-local'), 'trial:get-local must be registered');
  assert.ok(SENTINEL, 'TRIAL_SENTINEL_KEY must resolve');
});

test('a past user with an expired trial, the sentinel still set, and a retired promo is reopened', async () => {
  // The state an upgrading user really has: trial long over, claim never cleared,
  // sentinel + `natively` route still stored (they never reopened the app since).
  cm.setTrialToken('natively_trial_OLD', iso(Date.now() - 5 * DAY), iso(Date.now() - 5 * DAY - 1_800_000));
  cm.setNativelyApiKey(SENTINEL);
  ledger.record('trial_promo', 'never');
  assert.equal(promoRetired(), true, 'precondition');
  assert.equal(cm.getTrialClaimed(), true, 'precondition');
  sends.length = 0;

  const res = await getLocal();

  assert.equal(res.trialClaimed, false, 'the renderer is told the device has not claimed a trial');
  assert.equal(res.hasToken, false);
  assert.equal(cm.getTrialClaimed(), false, 'the claimed flag is gone from credentials');
  assert.equal(cm.getTrialToken(), undefined, 'and the expired token');
  assert.notEqual(cm.getNativelyApiKey(), SENTINEL, 'the trial routing was stood down BEFORE the token went');
  assert.equal(promoRetired(), false, 'the trial promo card is back');
  assert.equal(sm.get('trialCampaignReset'), CAMPAIGN, 'the marker is written last');
  assert.ok(sends.some((s) => s.channel === 'cards:changed'), 'open windows learn the ledger changed');
  assert.ok(sends.some((s) => s.channel === 'credentials-changed'), 'and the credentials');
});

test('it runs ONCE: a promo dismissed after the campaign stays dismissed', async () => {
  ledger.record('trial_promo', 'never');
  assert.equal(promoRetired(), true, 'precondition');
  await getLocal();
  await getLocal();
  assert.equal(promoRetired(), true, 'the second launch must not reopen it');
});

test('a trial claimed AFTER the campaign is respected', async () => {
  cm.setTrialToken('natively_trial_NEW', iso(Date.now() + 20 * 60_000), iso(Date.now() - 10 * 60_000));
  const res = await getLocal();
  assert.equal(res.hasToken, true);
  assert.equal(res.trialClaimed, true);
});

test('a LIVE trial is never touched and leaves no marker, so the next launch re-checks', async () => {
  sm.set('trialCampaignReset', undefined);
  ledger.record('trial_promo', 'never');
  const res = await getLocal();
  assert.equal(res.hasToken, true, 'the running trial survives');
  assert.equal(res.expired, false);
  assert.equal(cm.getTrialClaimed(), true);
  assert.equal(promoRetired(), true, 'and the ledger was not reopened under it');
  assert.equal(sm.get('trialCampaignReset'), undefined, 'no marker while a trial is live');
});

// WHO IS RESET. Only a user with no licence, no real Natively key and no AI key of their
// own. Everyone else keeps their claim, their retired promo and their (absent) marker; the
// normal expiry flow still settles their old trial and reverts the trial's route.
const CUTOFF = Date.parse('2026-09-29T10:25:31Z');
const oldExpiredTrial = () =>
  cm.setTrialToken('natively_trial_OLD2', iso(CUTOFF - 3 * DAY + 1_800_000), iso(CUTOFF - 3 * DAY));
async function assertLeftAlone(res) {
  assert.equal(sm.get('trialCampaignReset'), undefined, 'no marker');
  assert.equal(cm.getTrialClaimed(), true, 'the claim is untouched');
  assert.equal(promoRetired(), true, 'the promo stays retired');
  assert.equal(res.trialClaimed, true);
  assert.notEqual(cm.getNativelyApiKey(), SENTINEL, 'the normal expiry flow still reverted the trial route');
}

test('a user with their OWN AI key is left alone (BYOK)', async () => {
  sm.set('trialCampaignReset', undefined);
  cm.setGeminiApiKey('AIza-own-key-test');
  ledger.record('trial_promo', 'never');
  oldExpiredTrial();
  cm.setNativelyApiKey(SENTINEL);
  await assertLeftAlone(await getLocal());
  assert.equal(cm.getGeminiApiKey(), 'AIza-own-key-test', 'and their key is untouched');
});

test('...and once they drop that key they are a no-key user and ARE reset, on a later launch', async () => {
  cm.setGeminiApiKey('');
  const res = await getLocal();
  assert.equal(res.trialClaimed, false);
  assert.equal(cm.getTrialClaimed(), false);
  assert.equal(promoRetired(), false);
  assert.equal(sm.get('trialCampaignReset'), CAMPAIGN);
});

test('a user with a real Natively key (a plan) is left alone', async () => {
  sm.set('trialCampaignReset', undefined);
  cm.setNativelyApiKey('natively_real_key_test');
  cm.setTrialToken('natively_trial_OLD3', iso(CUTOFF - 3 * DAY + 1_800_000), iso(CUTOFF - 3 * DAY));
  ledger.record('trial_promo', 'never');
  const res = await getLocal();
  assert.equal(sm.get('trialCampaignReset'), undefined);
  assert.equal(cm.getTrialClaimed(), true);
  assert.equal(promoRetired(), true);
  assert.equal(cm.getNativelyApiKey(), 'natively_real_key_test', 'a real key is never mistaken for the sentinel');
  assert.equal(res.trialClaimed, true);
  cm.setNativelyApiKey('');
});

test('a licensed user is left alone', async () => {
  const licence = path.join(userData, 'license.enc');
  fs.writeFileSync(licence, 'x'); // the same file check isLicensed() falls back to
  try {
    sm.set('trialCampaignReset', undefined);
    oldExpiredTrial();
    cm.setNativelyApiKey(SENTINEL);
    ledger.record('trial_promo', 'never');
    await assertLeftAlone(await getLocal());
  } finally {
    fs.rmSync(licence, { force: true });
  }
});

// Dated from the cutoff, not from a calendar day: a trial that began just after the
// server reset and has since expired. Only constructible once the clock is past
// cutoff + trial length, so it skips (never passes vacuously) before that.
test('a trial that STARTED after the server reset is the new campaign: no third trial',
  { skip: Date.now() < CUTOFF + 31 * 60_000 && 'clock is before the cutoff + one trial length' },
  async () => {
    sm.set('trialCampaignReset', undefined);
    cm.setNativelyApiKey('');
    cm.setTrialToken('natively_trial_SECOND', iso(CUTOFF + 31 * 60_000), iso(CUTOFF + 60_000));
    assert.equal(cm.getTrialClaimed(), true, 'precondition');
    await getLocal();
    assert.equal(cm.getTrialClaimed(), true, 'the claim is kept');
    assert.equal(sm.get('trialCampaignReset'), CAMPAIGN, 'and the campaign is closed for this install');
  });
