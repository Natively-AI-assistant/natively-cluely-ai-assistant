// electron/services/FunnelTelemetry.ts, EXECUTED out of the compiled bundle:
// when it is on and when it is off, what it reports for itself, and what it
// sends where.
//
// The switches are the part that matters most. A development or agent launch
// must never report to production, and a user who turned telemetry off must
// not have a single event recorded or a single link tagged.
//
// Each case loads a FRESH copy of the bundle against its own user-data
// directory, so the singletons inside (settings, install id, queue) start
// clean. Nothing reaches a network: fetch is a stub.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/FunnelTelemetry2026_10_01.test.mjs
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/services/FunnelTelemetry.js');
const HAVE_BUILD = fs.existsSync(COMPILED);
const PRO_LINK = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const ENV_KEYS = ['NATIVELY_FUNNEL_ENDPOINT', 'NATIVELY_FUNNEL_ENABLED', 'NATIVELY_API_URL'];

const origLoad = Module._load;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const origFetch = globalThis.fetch;

/** Load a fresh FunnelTelemetry against a fresh user-data directory. */
function load({ packaged = true, settings, env = {}, state } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-telemetry-'));
  if (settings) fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
  if (state) fs.writeFileSync(path.join(userData, 'funnel_state.json'), JSON.stringify(state));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const noop = () => {};
  const fakeElectron = {
    app: {
      getPath: () => userData, getAppPath: () => ROOT, isPackaged: packaged,
      getVersion: () => '9.9.9-test', getName: () => 'natively',
      on: noop, once: noop, off: noop, removeAllListeners: noop,
      whenReady: () => Promise.resolve(), isReady: () => true,
    },
    safeStorage: { isEncryptionAvailable: () => false },
    BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: noop, on: noop },
    shell: {}, dialog: {}, nativeTheme: { on: noop }, screen: { on: noop },
  };
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, ...rest);
  };
  delete require.cache[COMPILED];
  // SettingsManager anchors its instance on globalThis so every bundle in a
  // process shares one. A fresh case needs a fresh one, read from ITS settings file.
  delete globalThis.__nativelySettingsManagerV1__;
  const { FunnelTelemetry } = require(COMPILED);
  const ft = FunnelTelemetry.getInstance();
  const posts = [];
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), headers: init.headers, events: JSON.parse(init.body).events });
    return { ok: true, status: 200, json: async () => ({ ok: true, rejected_ids: [] }) };
  };
  const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(userData, name), 'utf8')); } catch { return null; } };
  return {
    ft, userData, posts,
    queue: () => read('funnel_queue.json')?.events ?? [],
    state: () => read('funnel_state.json'),
    installId: () => { try { return fs.readFileSync(path.join(userData, 'install_id.txt'), 'utf8').trim(); } catch { return null; } },
  };
}

const SNAPSHOT = { entitlement: 'byok', hasOwnAi: true, hasApiKey: false, hasPro: false, meetingAi: 'own' };

describe('FunnelTelemetry', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
  afterEach(() => {
    Module._load = origLoad;
    globalThis.fetch = origFetch;
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });

  // ── The switches ───────────────────────────────────────────────────────────

  test('an unpackaged build records nothing, tags nothing and sends nothing', async () => {
    const h = load({ packaged: false });
    assert.equal(h.ft.isEnabled(), false);
    assert.equal(h.ft.track('app_first_run'), 'disabled');
    assert.deepEqual(h.ft.tagOutgoingUrl(PRO_LINK, 'trial_card'), { url: PRO_LINK, checkout: false, product: null, surface: 'trial_card' });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted();
    h.ft.meetingEnded();
    await h.ft.tick();
    assert.equal(h.posts.length, 0);
    assert.deepEqual(h.queue(), []);
    assert.equal(h.state(), null, 'not even the local state file is written');
  });

  test('a packaged build is on, and reports to production', async () => {
    const h = load({ packaged: true });
    assert.equal(h.ft.isEnabled(), true);
    assert.equal(h.ft.track('trial_expired'), 'queued');
    await h.ft.tick();
    assert.equal(h.posts[0].url, 'https://api.natively.software/v1/telemetry/funnel');
    assert.deepEqual(Object.keys(h.posts[0].headers), ['Content-Type'], 'no key, no token');
  });

  test('telemetry turned off in settings: off, in a packaged build too', async () => {
    const h = load({ packaged: true, settings: { telemetryEnabled: false } });
    assert.equal(h.ft.isEnabled(), false);
    assert.equal(h.ft.track('trial_expired'), 'disabled');
    assert.equal(h.ft.tagOutgoingUrl(PRO_LINK, 'trial_card').url, PRO_LINK, 'the checkout link is not tagged either');
    await h.ft.tick();
    assert.equal(h.posts.length, 0);
  });

  test('telemetry explicitly on in settings is on', () => {
    assert.equal(load({ packaged: true, settings: { telemetryEnabled: true } }).ft.isEnabled(), true);
  });

  test('NATIVELY_FUNNEL_ENABLED=0 turns it off; a dev endpoint turns it on in an unpackaged build, pointed at that endpoint', async () => {
    assert.equal(load({ packaged: true, env: { NATIVELY_FUNNEL_ENABLED: '0' } }).ft.isEnabled(), false);
    const h = load({ packaged: false, env: { NATIVELY_FUNNEL_ENDPOINT: 'http://127.0.0.1:4010/funnel' } });
    assert.equal(h.ft.isEnabled(), true);
    h.ft.track('trial_expired');
    await h.ft.tick();
    assert.equal(h.posts[0].url, 'http://127.0.0.1:4010/funnel', 'a dev launch never posts to production');
    assert.equal(load({ packaged: false, env: { NATIVELY_FUNNEL_ENDPOINT: 'javascript:alert(1)' } }).ft.isEnabled(), false);
  });

  // ── What it reports for itself ─────────────────────────────────────────────

  test('a new install reports its first run once and one snapshot per day', async () => {
    const h = load({ packaged: true });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    const sent = h.posts.flatMap((p) => p.events);
    assert.deepEqual(sent.map((e) => e.event_type), ['app_first_run', 'app_active_day']);
    assert.deepEqual(sent[1].props, { days_since_install: 0, has_own_ai: true, has_api_key: false, has_pro: false, meetings_total: 0 });
    for (const e of sent) {
      assert.equal(e.install_id, h.installId());
      assert.equal(e.entitlement, 'byok');
      assert.equal(e.platform, process.platform);
      assert.equal(e.app_version, '9.9.9-test');
    }
    assert.equal(h.state().firstRunSent, true);
    assert.equal(h.state().newInstall, true);

    await h.ft.tick();
    await h.ft.tick();
    assert.equal(h.posts.flatMap((p) => p.events).length, 2, 'later ticks the same day add nothing');
  });

  test('an install that already reported is never a first run again', async () => {
    const h = load({ packaged: true, state: { firstRunSent: true, lastActiveDay: '2020-01-01', meetings: 7 } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    const sent = h.posts.flatMap((p) => p.events);
    assert.deepEqual(sent.map((e) => e.event_type), ['app_active_day']);
    assert.equal(sent[0].props.meetings_total, 7);
  });

  test('the daily snapshot waits for the resolver instead of reporting a guess', async () => {
    const h = load({ packaged: true, state: { firstRunSent: true } });
    await h.ft.tick();
    assert.equal(h.posts.length, 0);
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    assert.deepEqual(h.posts.flatMap((p) => p.events).map((e) => e.event_type), ['app_active_day']);
  });

  test('a resolver that throws costs the entitlement, not the event', () => {
    const h = load({ packaged: true });
    h.ft.setSnapshotResolver(() => { throw new Error('credentials unreadable'); });
    assert.equal(h.ft.track('trial_expired'), 'queued');
    assert.equal(h.queue()[0].entitlement, 'none');
  });

  test('meetings: the first one on a new install is marked first, and its length is whole minutes', async () => {
    const h = load({ packaged: true });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick(); // decides this is a new install
    h.ft.meetingStarted();
    h.ft.meetingEnded();
    h.ft.meetingEnded(); // a second end with no start reports nothing
    await new Promise((r) => setTimeout(r, 2100));
    h.ft.meetingStarted();
    const events = h.queue().map((e) => [e.event_type, e.props]);
    assert.deepEqual(events, [
      ['meeting_started', { first: true, ai: 'own' }],
      ['meeting_ended', { minutes: 0, first: true }],
      ['meeting_started', { first: false, ai: 'own' }],
    ]);
    assert.equal(h.state().meetings, 2);
  });

  test('an install that upgraded into this code never has a "first" meeting', () => {
    const h = load({ packaged: true, state: { firstRunSent: true, lastActiveDay: '', meetings: 0 } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted();
    assert.deepEqual(h.queue()[0].props, { first: false, ai: 'own' });
  });

  test('a key entry carries how long ago the trial started and the own-keys exit happened', () => {
    const h = load({ packaged: true });
    h.ft.keyEntered('api_key', 'invalid');
    assert.deepEqual(h.queue().at(-1).props, { kind: 'api_key', result: 'invalid' }, 'no ages when neither ever happened');
    h.ft.trialStarted();
    h.ft.byokExited();
    h.ft.keyEntered('api_key', 'ok');
    assert.deepEqual(h.queue().at(-1).props, { kind: 'api_key', result: 'ok', mins_since_trial_start: 0, mins_since_byok_exit: 0 });
    h.ft.keyEntered('pro_licence', 'ok');
    assert.equal(h.queue().at(-1).props.kind, 'pro_licence');
  });

  test('a checkout link is tagged with this install; other links and odd surfaces are handled', () => {
    const h = load({ packaged: true });
    const tagged = h.ft.tagOutgoingUrl(PRO_LINK, 'quota_banner');
    const url = new URL(tagged.url);
    assert.equal(url.searchParams.get('metadata_install_id'), h.installId());
    assert.equal(url.searchParams.get('metadata_surface'), 'quota_banner');
    assert.deepEqual([tagged.checkout, tagged.product, tagged.surface], [true, 'api_pro', 'quota_banner']);
    assert.equal(h.ft.tagOutgoingUrl(PRO_LINK, 'Bad Surface!').surface, 'other');
    assert.deepEqual(h.ft.tagOutgoingUrl('https://natively.software/', 'other'), { url: 'https://natively.software/', checkout: false, product: null, surface: 'other' });
  });

  test('the queue and state files live in the user-data directory and nowhere else', () => {
    const h = load({ packaged: true });
    h.ft.trialStarted();
    h.ft.track('trial_expired');
    const files = fs.readdirSync(h.userData).filter((f) => f.startsWith('funnel_'));
    assert.deepEqual(files.sort(), ['funnel_queue.json', 'funnel_state.json']);
  });
});
