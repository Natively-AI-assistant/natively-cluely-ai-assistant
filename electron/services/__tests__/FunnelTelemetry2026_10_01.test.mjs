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
  // The registration a real server would do: a challenge (easy here), then a
  // token for a solved one. `server` lets a case change how the server answers.
  const registrations = [];
  const server = { funnelStatus: 200, tokens: 0 };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const body = JSON.parse(init.body);
    if (u.endsWith('/challenge')) {
      registrations.push({ url: u, body, headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ ok: true, challenge: `fic1.test${registrations.length}.sig`, difficulty: 6 }) };
    }
    if (u.endsWith('/register')) {
      registrations.push({ url: u, body, headers: init.headers });
      server.tokens++;
      return { ok: true, status: 200, json: async () => ({ ok: true, install_token: `fit1.token${server.tokens}.sig` }) };
    }
    posts.push({ url: u, headers: init.headers, events: body.events });
    if (server.funnelStatus !== 200) return { ok: false, status: server.funnelStatus, json: async () => ({ ok: false, error: 'install_token_invalid' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, rejected_ids: [] }) };
  };
  const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(userData, name), 'utf8')); } catch { return null; } };
  return {
    ft, userData, posts, registrations, server,
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
    assert.deepEqual(h.registrations.map((r) => r.url), ['https://api.natively.software/v1/telemetry/challenge', 'https://api.natively.software/v1/telemetry/register']);
    assert.deepEqual(Object.keys(h.posts[0].headers), ['Content-Type', 'x-install-token'], 'no key and no trial token: this install has neither');
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
    assert.deepEqual(h.registrations.map((r) => r.url), ['http://127.0.0.1:4010/challenge', 'http://127.0.0.1:4010/register'], 'and registers with the same dev server');
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

  // ── Who it says this is ────────────────────────────────────────────────────

  const HWID = 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const KEY = 'natively_sk_' + 'k'.repeat(40);
  const TOKEN = 'natively_trial_eyJpZCI6IngifQ.c2lnbmF0dXJl';

  test('events carry the device id, and requests carry the trial token and key as headers', async () => {
    const h = load({ packaged: true });
    h.ft.setIdentityResolver(() => ({ deviceId: HWID, trialToken: TOKEN, apiKey: KEY }));
    h.ft.track('trial_expired');
    assert.equal(h.queue()[0].device_id, HWID);
    const onDisk = fs.readFileSync(path.join(h.userData, 'funnel_queue.json'), 'utf8');
    assert.ok(!onDisk.includes(KEY) && !onDisk.includes(TOKEN), 'credentials are never written to the queue file');
    await h.ft.tick();
    assert.deepEqual(h.posts[0].headers, { 'Content-Type': 'application/json', 'x-trial-token': TOKEN, 'x-natively-key': KEY, 'x-install-token': 'fit1.token1.sig' });
    for (const r of h.registrations) assert.deepEqual(r.headers, { 'Content-Type': 'application/json' }, 'registering sends no key, no trial token and no device id');
  });

  test('an install with no device id and no credentials still reports, as itself', async () => {
    const h = load({ packaged: true });
    h.ft.setIdentityResolver(() => ({}));
    h.ft.track('trial_expired');
    assert.equal('device_id' in h.queue()[0], false);
    await h.ft.tick();
    assert.deepEqual(Object.keys(h.posts[0].headers), ['Content-Type', 'x-install-token']);
  });

  test('an identity resolver that throws costs the identity, not the event', async () => {
    const h = load({ packaged: true });
    h.ft.setIdentityResolver(() => { throw new Error('credential store locked'); });
    assert.equal(h.ft.track('trial_expired'), 'queued');
    await h.ft.tick();
    assert.equal(h.posts.length, 1);
  });

  test('with Usage statistics off, neither the device id nor a credential is sent anywhere', async () => {
    const h = load({ packaged: true, settings: { telemetryEnabled: false } });
    h.ft.setIdentityResolver(() => ({ deviceId: HWID, trialToken: TOKEN, apiKey: KEY }));
    h.ft.track('trial_expired');
    assert.equal(h.ft.featureUsed('answer'), 'disabled');
    await h.ft.tick();
    assert.equal(h.posts.length, 0);
    assert.equal(h.registrations.length, 0, 'not even a registration challenge is asked for');
    assert.deepEqual(h.queue(), []);
  });

  test('a feature is reported once per local day, and again the next day', () => {
    const h = load({ packaged: true, state: { firstRunSent: true, featuresDay: '2020-01-01', featuresUsed: ['answer'] } });
    assert.equal(h.ft.featureUsed('answer'), 'queued', 'a list from another day does not count');
    assert.equal(h.ft.featureUsed('answer'), 'duplicate');
    assert.equal(h.ft.featureUsed('recap'), 'queued');
    assert.equal(h.ft.featureUsed('not_a_feature'), 'invalid');
    assert.deepEqual(h.queue().map((e) => e.props.feature), ['answer', 'recap']);
    assert.deepEqual(h.state().featuresUsed, ['answer', 'recap']);
  });

  test('a meeting reports how many answers it produced, as a count', () => {
    const h = load({ packaged: true });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(3);          // three answers already in the log from before
    h.ft.meetingEnded(7);
    assert.equal(h.queue().at(-1).props.answers, 4);
    return new Promise((r) => setTimeout(r, 2100)).then(() => {
      h.ft.meetingStarted(7);
      h.ft.meetingEnded(2);          // the log was cleared when the meeting started
      assert.equal(h.queue().at(-1).props.answers, 2);
      h.ft.meetingStarted(0);
      h.ft.meetingEnded();           // no count available: the field is left out, not guessed
      assert.equal('answers' in h.queue().at(-1).props, false);
    });
  });

  // ── Registering the install ────────────────────────────────────────────────

  test('an install registers once, keeps its token on disk, and does not register again', async () => {
    const h = load({ packaged: true });
    h.ft.track('trial_expired');
    await h.ft.tick();
    assert.equal(h.registrations.length, 2, 'one challenge, one register');
    assert.deepEqual(h.registrations[0].body, { install_id: h.installId() });
    assert.match(String(h.registrations[1].body.solution), /^[0-9]+$/);
    assert.deepEqual(h.state().tokens, { [h.installId()]: 'fit1.token1.sig' });
    await new Promise((r) => setTimeout(r, 2100));
    h.ft.track('trial_expired');
    await h.ft.tick();
    assert.equal(h.registrations.length, 2, 'the second delivery reused the token');
    assert.equal(h.posts.length, 2);
    assert.equal(h.posts[1].headers['x-install-token'], 'fit1.token1.sig');
  });

  test('a token stored by an earlier launch is used without registering', async () => {
    const first = load({ packaged: true });
    first.ft.track('trial_expired');
    await first.ft.tick();
    const id = first.installId();
    // A new process, the same user-data: only the files carry over.
    const state = first.state();
    const h = load({ packaged: true, state });
    fs.writeFileSync(path.join(h.userData, 'install_id.txt'), id);
    h.ft.track('trial_expired');
    await h.ft.tick();
    assert.equal(h.registrations.length, 0);
    assert.equal(h.posts[0].headers['x-install-token'], 'fit1.token1.sig');
  });

  test('during a meeting the install does not register and nothing is sent; afterwards it does both', async () => {
    const h = load({ packaged: true, state: { firstRunSent: true, lastActiveDay: '2099-01-01' } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    await h.ft.tick();
    assert.equal(h.registrations.length, 0, 'the puzzle never runs during a meeting');
    assert.equal(h.posts.length, 0);
    assert.ok(h.queue().length >= 1, 'the events wait');
    h.ft.meetingEnded(0);
    await h.ft.tick();
    assert.equal(h.registrations.length, 2);
    assert.equal(h.posts.length, 1);
    assert.deepEqual(h.queue(), []);
  });

  test('a token the server refuses is forgotten; the events are kept and go out with a new one', async () => {
    const h = load({ packaged: true, state: { firstRunSent: true } });
    h.ft.track('trial_expired');
    h.server.funnelStatus = 401;
    await h.ft.tick();
    assert.equal(h.posts.length, 1);
    assert.equal(h.queue().length, 1, 'a 401 never costs an event');
    assert.deepEqual(h.state().tokens, {}, 'the refused token is gone');
    h.server.funnelStatus = 200;
    // Step past the delivery backoff by rewriting the stored retry time.
    const q = JSON.parse(fs.readFileSync(path.join(h.userData, 'funnel_queue.json'), 'utf8'));
    assert.ok(q.nextAttemptAt > Date.now());
    return new Promise((resolve) => setTimeout(resolve, 10)).then(async () => {
      // A fresh process is the simplest way to be past the backoff with the same files.
      const again = load({ packaged: true, state: h.state() });
      fs.writeFileSync(path.join(again.userData, 'install_id.txt'), h.installId());
      fs.writeFileSync(path.join(again.userData, 'funnel_queue.json'), JSON.stringify({ ...q, attempt: 0, nextAttemptAt: 0 }));
      await again.ft.tick();
      assert.equal(again.registrations.length, 2, 'it registered again');
      assert.equal(again.posts.length, 1);
      assert.equal(again.posts[0].headers['x-install-token'], 'fit1.token1.sig');
      assert.deepEqual(again.queue(), []);
    });
  });

  test('the first tick is held back from launch, and the solver never uses a worker thread', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/services/FunnelTelemetry.ts'), 'utf8');
    assert.match(src, /const FIRST_TICK_MS = 30_000;/);
    assert.match(src, /const first = setTimeout\(\(\) => \{ void this\.tick\(\); \}, FIRST_TICK_MS\);/);
    assert.match(src, /yieldFn: \(\) => new Promise<void>\(\(resolve\) => \{ setImmediate\(resolve\); \}\),/);
    assert.match(src, /shouldPause: \(\) => this\.meetingStartedAt !== null,/);
    assert.ok(!/worker_threads|new Worker\(/.test(src));
  });

  test('the queue and state files live in the user-data directory and nowhere else', () => {
    const h = load({ packaged: true });
    h.ft.trialStarted();
    h.ft.track('trial_expired');
    const files = fs.readdirSync(h.userData).filter((f) => f.startsWith('funnel_'));
    assert.deepEqual(files.sort(), ['funnel_queue.json', 'funnel_state.json']);
  });
});
