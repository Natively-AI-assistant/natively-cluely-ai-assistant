// electron/services/__tests__/FunnelRunEnd2026_11_14.test.mjs
//
// app_run_ended: the next launch reports, once, how the previous run ended,
// read from the lifecycle marker it left. Drives the REAL compiled
// FunnelTelemetry (with the tracker bundled into it) against a fresh userData.
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/FunnelRunEnd2026_11_14.test.mjs

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
function load({ packaged = true, settings, env = {}, state, marker, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-run-end-')) } = {}) {
  if (marker) fs.writeFileSync(path.join(userData, 'lifecycle-marker.json'), JSON.stringify(marker));
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
const MIN = 60_000;
const sent = (h, type) => h.posts.flatMap((p) => p.events).filter((e) => e.event_type === type);
const of = (h, type) => h.queue().filter((e) => e.event_type === type);
const iso = (ms) => new Date(ms).toISOString();
const T = Date.now() - 5 * 60 * MIN;
const vanished = {
  pid: process.pid + 7, startedAt: iso(T), lastEvent: 'app-start', lastEventAt: iso(T), aliveAt: iso(T + 95 * MIN),
  quitReason: null, version: '9.9.8', crashes: { renderer: 1, gpu: 0, helper: 2, oom: 1 },
};

describe('app_run_ended (2026-11-14)', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
  afterEach(() => {
    Module._load = origLoad;
    globalThis.fetch = origFetch;
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });

  test('a run that vanished is reported once, with its counts, and not again on the next launch', async () => {
    const h = load({ state: { firstRunSent: true }, marker: vanished });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    const ev = sent(h, 'app_run_ended');
    assert.equal(ev.length, 1);
    const { computer_restarted, ...rest } = ev[0].props;
    assert.equal(typeof computer_restarted, 'boolean', 'the boot time is read from the OS');
    assert.deepEqual(rest, {
      how: 'vanished', minutes: 95, in_meeting: false,
      renderer_crashes: 1, gpu_crashes: 0, helper_crashes: 2, out_of_memory: true, updated: true,
    });
    assert.equal(h.state().runEndReported, `${vanished.pid}:${vanished.startedAt}`);
    await h.ft.tick();
    assert.equal(sent(h, 'app_run_ended').length, 1, 'once per launch');
    // Another launch over the same files, the marker unchanged (this one never installed the tracker).
    Module._load = origLoad;
    const again = load({ userData: h.userData });
    again.ft.setSnapshotResolver(() => SNAPSHOT);
    await again.ft.tick();
    assert.equal(sent(again, 'app_run_ended').length, 0, 'the same run is never reported twice');
  });

  test('a meeting left running says in_meeting, and is still reported as cut off', async () => {
    const startedAt = T + 10 * MIN;
    const h = load({
      state: { firstRunSent: true, openMeeting: { startedAt, seenAt: startedAt + 20 * MIN, first: false, boot: 'an-earlier-launch' } },
      marker: { ...vanished, quitReason: 'fatal-main-error', quitMeta: { source: 'uncaughtException' } },
    });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    assert.equal(sent(h, 'app_run_ended')[0].props.how, 'crash');
    assert.equal(sent(h, 'app_run_ended')[0].props.in_meeting, true);
    assert.equal(sent(h, 'meeting_cut_off').length, 1);
  });

  test('a meeting started before the first tick: the run end is reported first, while the old note can still say a meeting ran', () => {
    const startedAt = T + 10 * MIN;
    const h = load({
      state: { firstRunSent: true, openMeeting: { startedAt, seenAt: startedAt + 4 * MIN, first: true, boot: 'an-earlier-launch' } },
      marker: { ...vanished, lastEvent: 'clean-exit', quitReason: 'os-shutdown' },
    });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    assert.deepEqual(h.queue().map((e) => e.event_type), ['app_run_ended', 'meeting_cut_off', 'meeting_started']);
    assert.deepEqual([of(h, 'app_run_ended')[0].props.how, of(h, 'app_run_ended')[0].props.in_meeting], ['os_shutdown', true]);
    h.ft.meetingStarted(0);
    assert.equal(of(h, 'app_run_ended').length, 1);
  });

  test('no marker, or one this process wrote, reports nothing', async () => {
    const h = load({ state: { firstRunSent: true } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    assert.equal(sent(h, 'app_run_ended').length, 0);
    const mine = load({ state: { firstRunSent: true }, marker: { ...vanished, pid: process.pid } });
    mine.ft.setSnapshotResolver(() => SNAPSHOT);
    await mine.ft.tick();
    assert.equal(sent(mine, 'app_run_ended').length, 0);
  });

  test('a launch that dies within seconds still reports the run before it: queued when the IPC handlers register, before any tick', () => {
    const h = load({ state: { firstRunSent: true }, marker: vanished });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    // No tick, no meeting: the process could die now.
    assert.equal(of(h, 'app_run_ended').length, 1);
    assert.equal(of(h, 'app_run_ended')[0].entitlement ?? 'byok', 'byok');
    assert.equal(h.state().runEndReported, `${vanished.pid}:${vanished.startedAt}`);
  });

  test('analytics switched off sends nothing and does not mark the run as reported', async () => {
    const h = load({ state: { firstRunSent: true }, marker: vanished, settings: { telemetryEnabled: false } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    assert.equal(sent(h, 'app_run_ended').length, 0);
    assert.equal(of(h, 'app_run_ended').length, 0);
  });
});
