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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-repairs-'));
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
const types = (h) => h.queue().map((e) => e.event_type);
const of = (h, type) => h.queue().filter((e) => e.event_type === type);
const MIN = 60_000;

describe('funnel repairs (2026-10-06)', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
  afterEach(() => {
    Module._load = origLoad;
    globalThis.fetch = origFetch;
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });

  // ── A meeting the app never sees end ───────────────────────────────────────

  test('a running meeting leaves a note on disk, and a normal end removes it', () => {
    const h = load({ state: { firstRunSent: true } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    const note = h.state().openMeeting;
    assert.equal(typeof note.boot, 'string');
    assert.ok(note.boot.length > 8);
    assert.ok(Math.abs(note.startedAt - Date.now()) < 5000);
    assert.equal(note.seenAt, note.startedAt);
    assert.equal(note.first, false);
    h.ft.meetingEnded(3);
    assert.equal(h.state().openMeeting, null);
    assert.deepEqual(types(h), ['meeting_started', 'meeting_ended']);
    assert.equal(of(h, 'meeting_ended')[0].props.answers, 3);
  });

  test('quitting with a meeting running records its end before the process goes: on disk, synchronously', () => {
    const h = load({ state: { firstRunSent: true } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(2);
    // What the before-quit handler calls. No await: the queue file must already hold it.
    h.ft.meetingEnded(7);
    const end = JSON.parse(fs.readFileSync(path.join(h.userData, 'funnel_queue.json'), 'utf8')).events.at(-1);
    assert.equal(end.event_type, 'meeting_ended');
    assert.equal(end.props.answers, 5);
    assert.equal(h.state().openMeeting, null);
    // The quit path and the normal end can both run: the second does nothing.
    h.ft.meetingEnded(7);
    assert.equal(of(h, 'meeting_ended').length, 1);
  });

  test('the quit handler reports the end before the database is closed down, and only on a quit that is really happening', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8');
    const at = src.indexOf('app.on("before-quit"');
    assert.notEqual(at, -1);
    const handler = src.slice(at, at + 2600);
    const deferred = handler.indexOf('if (deferQuitForLocalEmbeddingDrain(event)) return;');
    const report = handler.indexOf("funnelTelemetry.meetingEnded(appState.getIntelligenceManager().getAnswerCount())");
    const teardown = handler.indexOf("checkpointDatabase('before-quit')");
    assert.ok(deferred !== -1 && report !== -1 && teardown !== -1);
    assert.ok(deferred < report, 'a quit that is put off must not end the meeting in the numbers');
    assert.ok(report < teardown, 'the answer count is read while the session is still whole');
    const line = handler.slice(handler.lastIndexOf('\n', report) + 1, handler.indexOf('\n', report));
    assert.match(line, /^\s*try \{ require\('\.\/services\/FunnelTelemetry'\)\.funnelTelemetry\.meetingEnded\(.*\); \} catch \{/, 'analytics never blocks a quit');
  });

  test('a note left by an earlier launch is reported once as a meeting that was cut off', async () => {
    const startedAt = Date.now() - 3 * 60 * MIN;
    const h = load({ state: { firstRunSent: true, meetings: 4, openMeeting: { startedAt, seenAt: startedAt + 12.5 * MIN, first: false, boot: 'an-earlier-launch' } } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    await h.ft.tick();
    const sent = h.posts.flatMap((p) => p.events).filter((e) => e.event_type === 'meeting_cut_off');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].props, { minutes: 12, first: false }, 'measured to when the app was last up, not the three hours it was closed');
    assert.equal(h.state().openMeeting, null);
    await h.ft.tick();
    assert.equal(h.posts.flatMap((p) => p.events).filter((e) => e.event_type === 'meeting_cut_off').length, 1, 'once');
  });

  test('a new meeting started before the first tick reports the old note and replaces it', () => {
    const startedAt = Date.now() - 50 * MIN;
    const h = load({ state: { firstRunSent: true, openMeeting: { startedAt, seenAt: startedAt + 4 * MIN, first: true, boot: 'an-earlier-launch' } } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    assert.deepEqual(types(h), ['meeting_cut_off', 'meeting_started']);
    assert.deepEqual(of(h, 'meeting_cut_off')[0].props, { minutes: 4, first: true });
    const note = h.state().openMeeting;
    assert.notEqual(note.boot, 'an-earlier-launch');
    assert.ok(note.startedAt > startedAt);
  });

  test("this launch's own running meeting is never reported as cut off; a tick notes the app is still up", async () => {
    const h = load({ state: { firstRunSent: true } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    const before = h.state().openMeeting;
    const realNow = Date.now;
    Date.now = () => realNow() + 7 * MIN;
    try { await h.ft.tick(); } finally { Date.now = realNow; }
    assert.equal(of(h, 'meeting_cut_off').length, 0);
    assert.equal(h.posts.flatMap((p) => p.events).filter((e) => e.event_type === 'meeting_cut_off').length, 0);
    const after = h.state().openMeeting;
    assert.equal(after.boot, before.boot);
    assert.ok(after.seenAt - before.seenAt >= 6 * MIN, 'the note says the app was up seven minutes in');
    h.ft.meetingEnded(1);
    assert.equal(h.state().openMeeting, null);
  });

  test('with Usage statistics off no note is written, and an old note is not reported', async () => {
    const startedAt = Date.now() - 60 * MIN;
    const old = { startedAt, seenAt: startedAt + 9 * MIN, first: false, boot: 'an-earlier-launch' };
    const h = load({ settings: { telemetryEnabled: false }, state: { firstRunSent: true, openMeeting: old } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    h.ft.meetingEnded(2);
    await h.ft.tick();
    assert.deepEqual(h.queue(), []);
    assert.equal(h.posts.length, 0);
    assert.deepEqual(h.state().openMeeting, old, 'left exactly as it was');
  });

  test('an unpackaged build writes no note', () => {
    const h = load({ packaged: false });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    h.ft.meetingStarted(0);
    assert.equal(h.state(), null);
  });

  // ── An answer that did not come ────────────────────────────────────────────

  test('a failed answer: the cause, whose AI, whether a meeting was running; once per cause per day', () => {
    const h = load({ state: { firstRunSent: true } });
    h.ft.setSnapshotResolver(() => SNAPSHOT);
    assert.equal(h.ft.answerFailed('auth'), 'queued');
    assert.equal(h.ft.answerFailed('auth'), 'duplicate');
    h.ft.meetingStarted(0);
    assert.equal(h.ft.answerFailed('auth'), 'duplicate', 'a meeting starting does not make it new');
    assert.equal(h.ft.answerFailed('credits'), 'queued');
    assert.equal(h.ft.answerFailed('Incorrect API key provided'), 'invalid', 'a sentence is not a cause');
    assert.equal(h.ft.answerFailed(''), 'invalid');
    const failed = of(h, 'answer_failed');
    assert.deepEqual(failed.map((e) => e.props), [
      { cause: 'auth', ai: 'own', in_meeting: false },
      { cause: 'credits', ai: 'own', in_meeting: true },
    ]);
    assert.deepEqual(h.state().failuresReported, ['auth', 'credits']);
    for (const e of failed) assert.deepEqual(Object.keys(e.props).sort(), ['ai', 'cause', 'in_meeting']);
  });

  test('a new day reports the same cause again', () => {
    const h = load({ state: { firstRunSent: true, failuresDay: '2020-01-01', failuresReported: ['auth', 'setup'] } });
    h.ft.setSnapshotResolver(() => ({ ...SNAPSHOT, entitlement: 'none', hasOwnAi: false, meetingAi: 'none' }));
    assert.equal(h.ft.answerFailed('setup'), 'queued');
    assert.deepEqual(of(h, 'answer_failed')[0].props, { cause: 'setup', ai: 'none', in_meeting: false });
    assert.deepEqual(h.state().failuresReported, ['setup']);
    assert.notEqual(h.state().failuresDay, '2020-01-01');
  });

  test('with Usage statistics off a failed answer records nothing', () => {
    const h = load({ settings: { telemetryEnabled: false } });
    assert.equal(h.ft.answerFailed('auth'), 'disabled');
    assert.deepEqual(h.queue(), []);
    assert.equal(h.state(), null);
  });
});
