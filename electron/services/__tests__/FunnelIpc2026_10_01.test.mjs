// Funnel telemetry, EXECUTED through the real IPC handlers out of the compiled
// bundle: a checkout link really leaves tagged, a trial start really carries the
// install id and reports how it ended, a card outcome really becomes an event,
// and the renderer really cannot report what the catalogue does not hold.
//
// A source-level assertion cannot tell a hook that runs from one that is never
// reached. What is observed here is what the handlers DID: the URL handed to
// the system, the body sent to the server, and the events in the queue file.
//
// Nothing reaches a real server: fetch is a stub, and the funnel is pointed at
// a dev endpoint (NATIVELY_FUNNEL_ENDPOINT) that is never dispatched to. That
// variable is also what turns the funnel on in an unpackaged build.
//
// No platform branch is under test: the handlers read no process.platform for
// any of this, and the platform an event reports is asserted to be whatever
// this runner is.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/FunnelIpc2026_10_01.test.mjs
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPILED = path.join(ROOT, 'dist-electron/electron/ipcHandlers.js');
const HAVE_BUILD = fs.existsSync(COMPILED);

const PRO_LINK = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const handlers = new Map();
const opened = [];
const fetches = [];
let userData;
let trialStart = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) });

const call = (channel, ...args) => handlers.get(channel)({}, ...args);
const queue = () => {
  try { return JSON.parse(fs.readFileSync(path.join(userData, 'funnel_queue.json'), 'utf8')).events; } catch { return []; }
};
/** Events queued by `fn`, and nothing queued before it. */
const during = async (fn) => {
  const before = queue().length;
  const result = await fn();
  return { result, events: queue().slice(before) };
};
const installId = () => fs.readFileSync(path.join(userData, 'install_id.txt'), 'utf8').trim();
// The queue treats the same event inside two seconds as one. Tests that repeat
// an event on purpose step past that window.
const settle = () => new Promise((r) => setTimeout(r, 2100));

describe('funnel telemetry through the real IPC handlers', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
  before(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-ipc-'));
    process.env.NATIVELY_FUNNEL_ENDPOINT = 'http://127.0.0.1:9/never-dispatched';
    delete process.env.NATIVELY_FUNNEL_ENABLED;
    const win = { isDestroyed: () => false, webContents: { send() {} } };
    const noop = () => {};
    const fakeElectron = {
      app: {
        getPath: () => userData, getAppPath: () => ROOT, isPackaged: false,
        getVersion: () => '9.9.9-test', getName: () => 'natively',
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
      dialog: {}, desktopCapturer: {}, systemPreferences: {},
      shell: { openExternal: async (url) => { opened.push(url); } },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => Buffer.from(b).toString('utf8'),
        getSelectedStorageBackend: () => 'basic_text',
      },
      nativeTheme: { on: noop }, screen: { on: noop },
      session: {}, globalShortcut: {}, Menu: {}, Tray: {}, clipboard: {},
    };
    const fakeNative = new Proxy({ getHardwareId: () => 'funnel-ipc-test-hardware-id' }, {
      get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : function nativeStub() {}),
    });
    const origLoad = Module._load;
    Module._load = function patched(request, ...rest) {
      if (request === 'electron') return fakeElectron;
      if (/[\\/]native-module[\\/]index\.[^\\/]+\.node$/.test(request)) return fakeNative;
      return origLoad.call(this, request, ...rest);
    };
    globalThis.fetch = async (url, init) => {
      fetches.push({ url: String(url), init });
      if (String(url).includes('/v1/trial/start')) return trialStart();
      return { ok: false, status: 503, json: async () => ({ error: 'not_stubbed' }) };
    };

    const mod = require(COMPILED);
    const appState = {
      processingHelper: { getLLMHelper: () => ({ setModel() {}, setNativelyKey() {} }) },
      sendModelChanged() {},
      reconfigureSttProvider: async () => {},
      getKnowledgeOrchestrator: () => null,
    };
    try { mod.initializeIpcHandlers(appState); } catch { /* app-lifecycle wiring only */ }
  });

  test('the harness reached every handler under test', () => {
    for (const channel of ['open-external', 'trial:start', 'trial:convert', 'cards:record', 'funnel:track']) {
      assert.ok(handlers.has(channel), `${channel} must be registered`);
    }
  });

  test('a checkout link leaves tagged, and the click is recorded', async () => {
    const { result, events } = await during(() => call('open-external', PRO_LINK, { surface: 'trial_card' }));
    assert.deepEqual(result, { ok: true });
    const url = new URL(opened.at(-1));
    assert.equal(url.origin + url.pathname, PRO_LINK);
    assert.match(installId(), UUID);
    assert.equal(url.searchParams.get('metadata_install_id'), installId());
    assert.equal(url.searchParams.get('metadata_surface'), 'trial_card');
    assert.equal(url.searchParams.get('metadata_product'), 'api_pro');
    assert.ok(!opened.at(-1).includes('funnel-ipc-test-hardware-id'), 'the hardware id is never put on a link');

    assert.equal(events.length, 1);
    const [e] = events;
    assert.equal(e.event_type, 'checkout_opened');
    assert.deepEqual(e.props, { product: 'api_pro', surface: 'trial_card', opened: true });
    assert.equal(e.install_id, installId());
    assert.equal(e.app_version, '9.9.9-test');
    assert.equal(e.platform, process.platform);
    assert.match(e.event_id, UUID);
  });

  test('a caller that names no surface, or an unknown one, is recorded as "other"', async () => {
    await settle();
    const a = await during(() => call('open-external', PRO_LINK));
    assert.equal(a.events[0].props.surface, 'other');
    assert.equal(new URL(opened.at(-1)).searchParams.get('metadata_surface'), 'other');
    await settle();
    const b = await during(() => call('open-external', PRO_LINK, { surface: '<script>' }));
    assert.equal(b.events[0].props.surface, 'other');
  });

  test('every other link is opened exactly as given and records nothing', async () => {
    for (const url of ['https://natively.software/pricing', 'https://customer.dodopayments.com/']) {
      const { result, events } = await during(() => call('open-external', url, { surface: 'trial_card' }));
      assert.deepEqual(result, { ok: true });
      assert.equal(opened.at(-1), url);
      assert.equal(events.length, 0);
    }
  });

  test('a refused link is still refused, and records nothing', async () => {
    const n = opened.length;
    const { result, events } = await during(() => call('open-external', 'file:///etc/passwd'));
    assert.deepEqual(result, { ok: false });
    assert.equal(opened.length, n);
    assert.equal(events.length, 0);
  });

  test('a card outcome becomes one card event; an unknown card is refused and records nothing', async () => {
    const shown = await during(() => call('cards:record', 'trial_promo', 'shown'));
    assert.equal(shown.result.ok, true);
    assert.deepEqual(shown.events.map((e) => [e.event_type, e.props]), [['card', { id: 'trial_promo', outcome: 'shown' }]]);
    const bad = await during(() => call('cards:record', 'not_a_card', 'shown'));
    assert.equal(bad.result.ok, false);
    assert.equal(bad.events.length, 0);
  });

  test('the renderer may report what only it can see, and nothing else', async () => {
    const ok = await during(() => call('funnel:track', 'trial_card', { mode: 'expired', action: 'shown' }));
    assert.deepEqual(ok.result, { ok: true, result: 'queued' });
    assert.deepEqual(ok.events[0].props, { mode: 'expired', action: 'shown' });

    const paywall = await during(() => call('funnel:track', 'paywall_hit', { feature: 'modes' }));
    assert.equal(paywall.events[0].event_type, 'paywall_hit');

    for (const [name, props, error] of [
      ['checkout_opened', { product: 'api_pro', surface: 'trial_card', opened: true }, 'unknown_event'],
      ['key_entered', { kind: 'api_key', result: 'ok' }, 'unknown_event'],
      ['app_first_run', {}, 'unknown_event'],
      ['trial_card', { mode: 'expired', action: 'byok' }, 'bad_prop:action'],
      ['trial_card', { mode: 'expired', action: 'plan_pro' }, 'bad_prop:action'],
      ['trial_card', { mode: 'expired', action: 'shown', note: 'hello there' }, 'unknown_prop:note'],
      ['paywall_hit', { feature: 'everything' }, 'bad_prop:feature'],
      [42, {}, 'unknown_event'],
    ]) {
      const r = await during(() => call('funnel:track', name, props));
      assert.deepEqual(r.result, { ok: false, error }, `${String(name)} ${JSON.stringify(props)}`);
      assert.equal(r.events.length, 0);
    }
  });

  test('a plan tile on the trial card is recorded even with no trial token to report', async () => {
    const { result, events } = await during(() => call('trial:convert', 'max'));
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(events.map((e) => [e.event_type, e.props]), [['trial_card', { mode: 'expired', action: 'plan_max' }]]);
    const none = await during(() => call('trial:convert', 'enterprise'));
    assert.equal(none.events.length, 0);
  });

  test('a refused trial start is reported with the reason, from the surface that asked', async () => {
    trialStart = async () => ({ ok: false, status: 403, json: async () => ({ error: 'trial_ip_limit' }) });
    const { result, events } = await during(() => call('trial:start', 'api_settings'));
    assert.equal(result.ok, false);
    assert.deepEqual(events.map((e) => [e.event_type, e.props]), [['trial_start_result', { surface: 'api_settings', result: 'ip_limit' }]]);
  });

  test('a trial start that cannot reach the server is reported as a network failure', async () => {
    trialStart = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
    const { result, events } = await during(() => call('trial:start'));
    assert.equal(result.ok, false);
    assert.deepEqual(events[0].props, { surface: 'other', result: 'network' });
  });

  test('a started trial sends the install id beside the hardware id, and reports ok', async () => {
    const now = Date.now();
    trialStart = async () => ({
      ok: true, status: 200,
      json: async () => ({
        ok: true, trial_token: 'natively_trial_TEST', already_used: false, expired: false,
        started_at: new Date(now).toISOString(), expires_at: new Date(now + 1_800_000).toISOString(),
        usage: { ai: 0, stt_seconds: 0, search: 0 }, limits: {},
      }),
    });
    const { result, events } = await during(() => call('trial:start', 'trial_promo'));
    assert.equal(result.ok, true, JSON.stringify(result));
    const sent = JSON.parse(fetches.filter((f) => f.url.includes('/v1/trial/start')).at(-1).init.body);
    assert.deepEqual(Object.keys(sent).sort(), ['app_version', 'hwid', 'install_id', 'platform']);
    assert.equal(sent.hwid, 'funnel-ipc-test-hardware-id');
    assert.equal(sent.install_id, installId());
    assert.equal(sent.platform, process.platform);
    assert.deepEqual(events.map((e) => [e.event_type, e.props]), [['trial_start_result', { surface: 'trial_promo', result: 'ok' }]]);
    assert.equal(events[0].entitlement, 'trial', 'by the time it is recorded the install is on its trial');
  });

  test('no event anywhere in the queue carries the hardware id, a key or a token', () => {
    const text = fs.readFileSync(path.join(userData, 'funnel_queue.json'), 'utf8');
    for (const secret of ['funnel-ipc-test-hardware-id', 'natively_trial_TEST', '__trial__']) {
      assert.ok(!text.includes(secret), `${secret} must not be in the funnel queue`);
    }
    const allowed = new Set(['event_id', 'event_type', 'client_event_ts', 'install_id', 'app_session_id', 'app_version', 'platform', 'entitlement', 'props']);
    for (const e of queue()) for (const k of Object.keys(e)) assert.ok(allowed.has(k), `unexpected field ${k}`);
  });

  // ── The switch (Settings › General › Advanced › Usage statistics) ──────────
  // Last on purpose: it turns the funnel off for this process.

  test('usage statistics are on until the user says otherwise', async () => {
    assert.ok(handlers.has('get-usage-statistics') && handlers.has('set-usage-statistics'));
    assert.equal(await call('get-usage-statistics'), true);
  });

  test('a value that is not a boolean is refused and changes nothing', async () => {
    for (const v of [undefined, null, 'false', 0, {}]) {
      assert.deepEqual(await call('set-usage-statistics', v), { success: false, error: 'invalid_value' });
    }
    assert.equal(await call('get-usage-statistics'), true);
  });

  test('turning it off stops events, stops link tagging, and discards what was queued', async () => {
    assert.ok(queue().length > 0, 'precondition: events are waiting');
    assert.deepEqual(await call('set-usage-statistics', false), { success: true });
    assert.equal(await call('get-usage-statistics'), false);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(queue(), [], 'the queue was emptied, not kept for later');
    assert.ok(!fetches.some((f) => f.url.includes('never-dispatched')), 'and nothing was sent on the way out');

    const tracked = await during(() => call('funnel:track', 'paywall_hit', { feature: 'modes' }));
    assert.deepEqual(tracked.result, { ok: true, result: 'disabled' });
    const link = await during(() => call('open-external', PRO_LINK, { surface: 'trial_card' }));
    assert.deepEqual(link.result, { ok: true }, 'the link still opens');
    assert.equal(opened.at(-1), PRO_LINK, 'exactly as written: no install id on it');
    const card = await during(() => call('cards:record', 'support', 'shown'));
    assert.equal(card.result.ok, true, 'the card ledger itself is unaffected');
    assert.equal(tracked.events.length + link.events.length + card.events.length, 0);

    trialStart = async () => ({ ok: false, status: 403, json: async () => ({ error: 'trial_ip_limit' }) });
    await call('trial:start', 'trial_promo');
    const sent = JSON.parse(fetches.filter((f) => f.url.includes('/v1/trial/start')).at(-1).init.body);
    assert.deepEqual(Object.keys(sent), ['hwid'], 'a trial start no longer carries the install id');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).telemetryEnabled, false, 'and the choice is on disk');
  });

  test('turning it back on starts recording again', async () => {
    assert.deepEqual(await call('set-usage-statistics', true), { success: true });
    assert.equal(await call('get-usage-statistics'), true);
    const { events } = await during(() => call('funnel:track', 'paywall_hit', { feature: 'profile_intelligence' }));
    assert.equal(events.length, 1);
  });
});

// ── main.ts ──────────────────────────────────────────────────────────────────
//
// main.js cannot be loaded into a test process, so these three hooks are read
// from the source. Comment lines are dropped first and each pattern is anchored
// to a statement, so prose in a comment cannot satisfy them.

describe('funnel telemetry hooks in main.ts', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const body = (name) => {
    const start = main.indexOf(`private async ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    const next = main.indexOf('\n  private async ', start + 10);
    return main.slice(start, next > 0 ? next : start + 20000);
  };

  test('the funnel starts once at launch and stops at quit', () => {
    assert.equal((main.match(/^\s*require\('\.\/services\/FunnelTelemetry'\)\.funnelTelemetry\.start\(\);$/gm) || []).length, 1);
    assert.equal((main.match(/^\s*try \{ require\('\.\/services\/FunnelTelemetry'\)\.funnelTelemetry\.stop\(\); \} catch/gm) || []).length, 1);
  });

  test('a meeting start and a meeting end are each reported once, inside a try', () => {
    assert.match(body('startMeetingTransition'), /^\s*try \{ require\('\.\/services\/FunnelTelemetry'\)\.funnelTelemetry\.meetingStarted\(\); \} catch/m);
    assert.match(body('endMeetingTransition'), /^\s*try \{ require\('\.\/services\/FunnelTelemetry'\)\.funnelTelemetry\.meetingEnded\(\); \} catch/m);
    assert.equal((main.match(/funnelTelemetry\.meetingStarted\(\)/g) || []).length, 1);
    assert.equal((main.match(/funnelTelemetry\.meetingEnded\(\)/g) || []).length, 1);
  });
});
